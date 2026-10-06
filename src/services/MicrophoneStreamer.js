import { AudioManager, AudioRecorder } from 'react-native-audio-api';

import { floatToPcm16, rmsLevel } from '../utils/pcm';

const TARGET_RATE = 16000; // plenty for speech, a third of the bandwidth of 48 kHz
const CHUNK_MS = 100; // small chunks keep STT latency low
const PRE_ROLL_CHUNKS = 2; // ~200 ms kept so the first syllable isn't lost on tap

/**
 * Keeps the phone's microphone running while the app is in the foreground ("warm"),
 * so a tap starts capturing instantly instead of waiting for the native recorder to
 * spin up. Audio is only forwarded to a *sink* while a turn is active; otherwise just the
 * last ~200 ms are kept in memory and nothing leaves the device.
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
    this.queue = Promise.resolve(); // open/close/restart never overlap (native recorder races)
    this.stats = { chunks: 0, lastChunkAt: 0, sampleRate: 0, lastError: null };
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
    this.recorder.onAudioReady(
      { sampleRate: TARGET_RATE, bufferLength: (TARGET_RATE * CHUNK_MS) / 1000, channelCount: 1 },
      ({ buffer }) => this.handleBuffer(buffer),
    );
    const res = await this.recorder.start();
    if (res.status === 'error') throw new Error(`Recorder failed: ${res.message}`);
    this.running = true;
  }

  /** Tear the native recorder down and bring it back up (recovers from a silent recorder). */
  restart() {
    return this.close().then(() => this.open());
  }

  handleBuffer(buffer) {
    const samples = buffer.getChannelData(0);
    this.stats.chunks++;
    this.stats.lastChunkAt = Date.now();
    this.stats.sampleRate = buffer.sampleRate;
    // The OS may not honour the requested rate: report the real one so the
    // consumer can declare it to Deepgram.
    const chunk = { pcm16: floatToPcm16(samples), sampleRate: buffer.sampleRate, level: rmsLevel(samples) };
    if (this.sink) this.sink(chunk);
    else {
      this.preRoll.push(chunk);
      if (this.preRoll.length > PRE_ROLL_CHUNKS) this.preRoll.shift();
    }
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
        this.recorder.clearOnAudioReady();
        await this.recorder.stop();
      } catch (error) {
        this.stats.lastError = String(error.message ?? error);
      }
    });
  }
}
