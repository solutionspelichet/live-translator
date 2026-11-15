import { appendSegments, groupWords, placeSegments } from '../../utils/diarize';
import { putBlob, deleteBlob } from '../../utils/blobStore';
import { deepgramLanguageFor, MULTI, newMeetingId } from '../../utils/meeting';
import { pcmSeconds, wavHeader } from '../../utils/wav';
import BackgroundService from '../BackgroundService';
import BackgroundTimers from '../BackgroundTimers';
import MicrophoneStreamer from '../MicrophoneStreamer';
import DeepgramSession from '../stt/DeepgramSession';

const USAGE_EVERY_MS = 5000;
const LIVE_MODEL = 'nova-3';
const BLOB_EVERY_BYTES = 16000 * 2 * 20; // 20 s of audio: small pieces are folded into a Blob (the browser may keep it off the JS heap)

/**
 * Web version of MeetingRecorder: same behaviour, but the audio is kept as Blobs (then one WAV in IndexedDB) instead of a file.
 * Keep the page open and the screen on while recording: a browser stops the microphone in the background.
 */
export default class MeetingRecorder {
  constructor({ language, title, settings, onUpdate, onUsage }) {
    this.id = newMeetingId();
    this.language = language;
    this.title = title;
    this.settings = settings;
    this.onUpdate = onUpdate;
    this.onUsage = onUsage;
    this.mic = new MicrophoneStreamer();
    this.session = null;
    this.segments = [];
    this.interim = '';
    this.bytes = 0;
    this.sampleRate = 16000;
    this.level = 0;
    this.liveError = null;
    this.running = false;
    this.pendingSeconds = 0;
    this.usageTimer = null;
    this.startedAt = 0;
    this.writeFailed = null;
    this.parts = []; // Blobs
    this.small = []; // Uint8Array pieces not yet folded
    this.smallBytes = 0;
  }

  get elapsedSec() {
    return pcmSeconds(this.bytes, this.sampleRate);
  }

  state() {
    return {
      elapsedSec: this.elapsedSec,
      level: this.level,
      segments: this.segments,
      interim: this.interim,
      liveStatus: this.session?.status ?? '—',
      liveError: this.liveError,
      writeError: this.writeFailed,
    };
  }

  emit() {
    this.onUpdate?.(this.state());
  }

  async start() {
    const { settings } = this;
    BackgroundService.start(); // keeps the screen awake
    this.mic.configure({ source: settings.micSource, input: settings.input, agc: settings.micAgc });
    this.mic.setGain(settings.micGain);
    await this.mic.open();
    this.startedAt = Date.now();
    this.running = true;
    this.mic.setSink((chunk) => this.onChunk(chunk));
    this.usageTimer = BackgroundTimers.setInterval(() => this.flushUsage(), USAGE_EVERY_MS);
  }

  fold() {
    if (!this.small.length) return;
    this.parts.push(new Blob(this.small));
    this.small = [];
    this.smallBytes = 0;
  }

  onChunk({ pcm16, sampleRate, level }) {
    if (!this.running) return;
    this.sampleRate = sampleRate;
    this.level = level;
    this.small.push(new Uint8Array(pcm16.slice(0)));
    this.smallBytes += pcm16.byteLength;
    this.bytes += pcm16.byteLength;
    if (this.smallBytes >= BLOB_EVERY_BYTES) this.fold();
    if (!this.session && !this.liveError) this.openSession(sampleRate);
    if (this.session) {
      this.session.sendAudio(pcm16);
      this.pendingSeconds += pcm16.byteLength / 2 / sampleRate;
    }
    this.emit();
  }

  openSession(sampleRate) {
    try {
      this.session = new DeepgramSession({
        sampleRate,
        timers: BackgroundTimers,
        model: LIVE_MODEL,
        languageCode: deepgramLanguageFor(this.language, LIVE_MODEL),
        diarize: true,
        endpointingMs: 500,
        onInterim: (text) => {
          this.interim = text;
        },
        onFinal: (text, _confidence, words) => this.onFinal(text, words),
        onError: (error) => {
          this.liveError = String(error?.message ?? error);
          this.session = null;
          this.emit();
        },
      });
    } catch (error) {
      this.liveError = String(error?.message ?? error);
    }
  }

  onFinal(text, words) {
    this.interim = '';
    let incoming = groupWords(words);
    if (!incoming.length) incoming = [{ speaker: 0, start: 0, end: 0, text }];
    incoming = placeSegments(incoming, this.elapsedSec);
    this.segments = appendSegments(this.segments, incoming);
    this.emit();
  }

  flushUsage() {
    if (this.pendingSeconds <= 0) return;
    this.onUsage?.({ [(this.language ?? MULTI) === MULTI ? 'dgNova3MultiSec' : 'dgNova3Sec']: this.pendingSeconds });
    this.pendingSeconds = 0;
  }

  async stop() {
    this.running = false;
    BackgroundTimers.clearInterval(this.usageTimer);
    this.mic.setSink(null);
    await this.mic.close();
    this.flushUsage();
    if (this.session) {
      try {
        await this.session.finish();
      } catch {}
    }
    this.session = null;
    this.fold();
    const uri = `idb:${this.id}`;
    try {
      await putBlob(uri, new Blob([wavHeader(this.bytes, this.sampleRate), ...this.parts], { type: 'audio/wav' }));
    } catch (error) {
      this.writeFailed ??= String(error?.message ?? error);
    }
    BackgroundService.stop();
    return {
      id: this.id,
      title: this.title,
      createdAt: this.startedAt || Date.now(),
      durationSec: this.elapsedSec,
      language: this.language ?? MULTI,
      audioUri: this.writeFailed ? null : uri,
      audioBytes: this.bytes + 44,
      source: 'live',
      liveError: this.liveError,
      segments: this.segments,
      speakers: {},
      minutes: [],
    };
  }

  async discard() {
    this.running = false;
    BackgroundTimers.clearInterval(this.usageTimer);
    this.mic.setSink(null);
    this.session?.abort();
    this.session = null;
    await this.mic.close();
    this.parts = [];
    this.small = [];
    await deleteBlob(`idb:${this.id}`).catch(() => {});
    BackgroundService.stop();
  }
}
