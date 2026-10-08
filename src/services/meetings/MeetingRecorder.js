import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { appendSegments, groupWords, placeSegments } from '../../utils/diarize';
import { deepgramLanguageFor, MULTI, newMeetingId } from '../../utils/meeting';
import { pcmSeconds, wavHeader } from '../../utils/wav';
import BackgroundService from '../BackgroundService';
import BackgroundTimers from '../BackgroundTimers';
import MicrophoneStreamer from '../MicrophoneStreamer';
import DeepgramSession from '../stt/DeepgramSession';

const USAGE_EVERY_MS = 5000;
const LIVE_MODEL = 'nova-3'; // the live view of a meeting uses Nova-3 (speakers, several languages)

/**
 * Records a meeting: the microphone goes (1) to a WAV file on the phone — the reference for the accurate second
 * pass — and (2) to a live Deepgram stream with speaker separation, for the transcript shown while recording.
 * Keeps working with the screen off (foreground service + wake lock, like the translator).
 *
 * If the live transcription cannot start (language unavailable live, network down…), the recording itself goes on:
 * everything can still be transcribed afterwards from the audio file.
 */
export default class MeetingRecorder {
  /**
   * @param {{language: string, title: string, settings: object,
   *          onUpdate: (state) => void, onUsage: (delta) => void}} opts
   */
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
    const dir = new Directory(Paths.document, 'meetings');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    this.file = new File(dir, `${this.id}.wav`);
    this.file.create({ intermediates: true, overwrite: true });
    this.handle = this.file.open(FileMode.ReadWrite);
    this.handle.writeBytes(wavHeader(0, this.sampleRate)); // sizes are patched when recording stops

    BackgroundService.start(); // optional, never blocks
    this.mic.configure({ source: settings.micSource, input: settings.input, agc: settings.micAgc });
    this.mic.setGain(settings.micGain);
    await this.mic.open();
    this.startedAt = Date.now();
    this.running = true;
    this.mic.setSink((chunk) => this.onChunk(chunk));
    this.usageTimer = BackgroundTimers.setInterval(() => this.flushUsage(), USAGE_EVERY_MS);
  }

  onChunk({ pcm16, sampleRate, level }) {
    if (!this.running) return;
    this.sampleRate = sampleRate;
    this.level = level;
    try {
      this.handle.writeBytes(new Uint8Array(pcm16));
      this.bytes += pcm16.byteLength;
    } catch (error) {
      // A full disk must be reported loudly: the audio is the reference of the meeting.
      this.writeFailed = String(error?.message ?? error);
    }
    if (!this.session && !this.liveError) this.openSession(sampleRate);
    if (this.session) {
      this.session.sendAudio(pcm16);
      this.pendingSeconds += pcm16.byteLength / 2 / sampleRate; // only the live stream is billed here
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
          this.session = null; // the audio file keeps being recorded
          this.emit();
        },
      });
    } catch (error) {
      this.liveError = String(error?.message ?? error);
    }
  }

  onFinal(text, words) {
    this.interim = '';
    // Timestamps are taken from our own clock (a reconnection restarts Deepgram's): the end of the words is "now".
    let incoming = groupWords(words);
    if (!incoming.length) incoming = [{ speaker: 0, start: 0, end: 0, text }];
    incoming = placeSegments(incoming, this.elapsedSec);
    this.segments = appendSegments(this.segments, incoming);
    this.emit();
  }

  flushUsage() {
    if (this.pendingSeconds <= 0) return;
    this.onUsage?.({ dgNova3Sec: this.pendingSeconds });
    this.pendingSeconds = 0;
  }

  /** @returns {Promise<object>} the meeting record, ready to be saved */
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
    try {
      this.handle.offset = 0;
      this.handle.writeBytes(wavHeader(this.bytes, this.sampleRate));
      this.handle.close();
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
      audioUri: this.file.uri,
      audioBytes: this.bytes + 44,
      source: 'live',
      liveError: this.liveError,
      segments: this.segments,
      speakers: {},
      minutes: [],
    };
  }

  /** Throw everything away (the user cancelled). */
  async discard() {
    this.running = false;
    BackgroundTimers.clearInterval(this.usageTimer);
    this.mic.setSink(null);
    this.session?.abort();
    this.session = null;
    await this.mic.close();
    try {
      this.handle?.close();
      if (this.file?.exists) this.file.delete();
    } catch {}
    BackgroundService.stop();
  }
}
