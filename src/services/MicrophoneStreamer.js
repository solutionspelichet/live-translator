import { Platform } from 'react-native';
import { AudioManager, AudioRecorder } from 'react-native-audio-api';

import Power from '../../modules/dualcast-power';
import MicGain from '../utils/gain';
import { floatToPcm16, pcm16Base64ToFloat, rmsLevel } from '../utils/pcm';

const TARGET_RATE = 16000; // plenty for speech, a third of the bandwidth of 48 kHz
const CHUNK_MS = 100; // small chunks keep STT latency low
const PRE_ROLL_CHUNKS = 2; // ~200 ms kept so the first syllable isn't lost on tap

/**
 * Keeps the phone's microphone running while the app is in the foreground ("warm"),
 * so a tap starts capturing instantly instead of waiting for the native recorder to
 * spin up. Audio is only forwarded to a *sink* while a turn is active; otherwise just the
 * last ~200 ms are kept in memory and nothing leaves the device.
 *
 * On Android the capture is done by our own native module (choice of the audio source, the phone's
 * own gain control); if it is unavailable or fails, react-native-audio-api's recorder is used.
 *
 * Chunk: { pcm16: ArrayBuffer, sampleRate: number, level: 0..1 }
 */
export default class MicrophoneStreamer {
  constructor() {
    this.recorder = new AudioRecorder();
    this.running = false;
    this.opening = null;
    this.sink = null;
    this.preRoll = [];
    this.gain = new MicGain({ mode: 'auto' });
    this.queue = Promise.resolve(); // open/close/restart never overlap (native recorder races)
    this.stats = { chunks: 0, lastChunkAt: 0, sampleRate: 0, gain: 1, lastError: null, backend: '—', zeroRun: 0, zeroChunks: 0, peak: 0, openedAt: 0 };
    this.config = { source: 'voice_recognition', deviceId: -1, agc: true };
    this.stopNative = null;
  }

  /**
   * Which microphone path to use. Takes effect on the next (re)start.
   * @returns {boolean} true if something changed (the caller should restart the mic)
   */
  configure({ source = 'voice_recognition', input = null, agc = true } = {}) {
    const deviceId = input && Number.isFinite(Number(input.id)) ? Number(input.id) : -1;
    const changed = source !== this.config.source || deviceId !== this.config.deviceId || agc !== this.config.agc;
    this.config = { source, deviceId, agc };
    return changed;
  }

  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  async ensurePermission() {
    let status = await AudioManager.checkRecordingPermissions();
    if (status !== 'Granted') status = await AudioManager.requestRecordingPermissions();
    if (status !== 'Granted') throw new Error('Microphone permission denied');
  }

  /** 'auto' (automatic gain control) or a fixed gain 1…32. */
  setGain(mode) {
    this.gain.setMode(mode);
  }

  /** Idempotent: resolves immediately when the mic is already running. */
  open() {
    return this.enqueue(async () => {
      if (this.running) return;
      try {
        await this.startRecorder();
      } catch (error) {
        this.stats.lastError = String(error.message ?? error);
        throw error;
      }
    });
  }

  async startRecorder() {
    await this.ensurePermission();

    if (Platform.OS === 'android' && Power.available) {
      const { source, deviceId, agc } = this.config;
      const native = Power.startCapture({ source, deviceId, agc, ns: false }, (base64) =>
        this.handleSamples(pcm16Base64ToFloat(base64), TARGET_RATE),
      );
      if (native.ok) {
        this.stopNative = native.stop;
        this.stats.backend = `natif · ${source} · ${native.status}`;
        this.running = true;
        this.stats.openedAt = Date.now();
        this.stats.zeroRun = 0;
        return;
      }
      this.stats.lastError = `capture native: ${native.status} (repli sur la bibliothèque)`;
    }

    this.recorder.onAudioReady(
      { sampleRate: TARGET_RATE, bufferLength: (TARGET_RATE * CHUNK_MS) / 1000, channelCount: 1 },
      ({ buffer }) => this.handleSamples(buffer.getChannelData(0), buffer.sampleRate),
    );
    const res = await this.recorder.start();
    if (res.status === 'error') throw new Error(`Recorder failed: ${res.message}`);
    this.stats.backend = 'bibliothèque';
    this.running = true;
    this.stats.openedAt = Date.now();
    this.stats.zeroRun = 0;
  }

  /** Tear the native recorder down and bring it back up (recovers from a silent recorder). */
  restart() {
    return this.close().then(() => this.open());
  }

  handleSamples(rawSamples, sampleRate) {
    // Raw level, before any gain: all zeros = the system silenced the recorder (see utils/micHealth.js).
    let peak = 0;
    for (let i = 0; i < rawSamples.length; i++) {
      const a = Math.abs(rawSamples[i]);
      if (a > peak) peak = a;
    }
    if (peak > this.stats.peak) this.stats.peak = peak;
    if (peak === 0) {
      this.stats.zeroRun++;
      this.stats.zeroChunks++;
    } else this.stats.zeroRun = 0;
    // Amplify before recognition: the phone usually lies flat between two people.
    const samples = this.gain.process(rawSamples);
    this.stats.chunks++;
    this.stats.gain = this.gain.current;
    this.stats.lastChunkAt = Date.now();
    this.stats.sampleRate = sampleRate;
    // The OS may not honour the requested rate: report the real one so the
    // consumer can declare it to Deepgram.
    const chunk = { pcm16: floatToPcm16(samples), sampleRate, level: rmsLevel(samples) };
    if (this.sink) this.sink(chunk);
    else {
      this.preRoll.push(chunk);
      if (this.preRoll.length > PRE_ROLL_CHUNKS) this.preRoll.shift();
    }
  }

  /** Per-turn figures for the journal (peak level, chunks of pure zeros). */
  resetTurnStats() {
    this.stats.peak = 0;
    this.stats.zeroChunks = 0;
  }

  /** Start (fn) or stop (null) forwarding audio. Starting replays the pre-roll first. */
  setSink(fn) {
    const buffered = this.preRoll;
    this.preRoll = [];
    this.sink = fn;
    if (fn) buffered.forEach(fn);
  }

  close() {
    return this.enqueue(async () => {
      this.sink = null;
      this.preRoll = [];
      if (!this.running) return;
      this.running = false;
      try {
        if (this.stopNative) {
          this.stopNative();
          this.stopNative = null;
        } else {
          this.recorder.clearOnAudioReady();
          await this.recorder.stop();
        }
      } catch (error) {
        this.stats.lastError = String(error.message ?? error);
      }
    });
  }
}
