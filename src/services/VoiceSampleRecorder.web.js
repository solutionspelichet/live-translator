import { ApiError } from '../utils/http';
import { CLONE_MAX_SEC, cloneName, parseCloneResult } from '../utils/voiceClone';
import { pcmSeconds, wavHeader } from '../utils/wav';
import MicrophoneStreamer from './MicrophoneStreamer';

/** Web version: the voice sample is kept in memory (at most CLONE_MAX_SEC) and posted to ElevenLabs as a multipart form. */
export default class VoiceSampleRecorder {
  constructor({ settings, onUpdate }) {
    this.settings = settings;
    this.onUpdate = onUpdate;
    this.mic = new MicrophoneStreamer();
    this.bytes = 0;
    this.sampleRate = 16000;
    this.running = false;
    this.chunks = [];
  }

  get seconds() {
    return pcmSeconds(this.bytes, this.sampleRate);
  }

  async start() {
    const { micSource, input, micAgc } = this.settings;
    this.mic.configure({ source: micSource, input, agc: micAgc });
    this.mic.setGain('auto');
    await this.mic.open();
    this.running = true;
    this.mic.setSink(({ pcm16, sampleRate, level }) => {
      if (!this.running) return;
      this.sampleRate = sampleRate;
      this.chunks.push(new Uint8Array(pcm16.slice(0)));
      this.bytes += pcm16.byteLength;
      this.onUpdate?.({ seconds: this.seconds, level });
      if (this.seconds >= CLONE_MAX_SEC) this.finish().then(() => this.onUpdate?.({ seconds: this.seconds, level: 0, done: true }));
    });
  }

  async finish() {
    if (!this.running) return this.seconds;
    this.running = false;
    this.mic.setSink(null);
    await this.mic.close();
    return this.seconds;
  }

  async upload({ apiKey, base, name }) {
    await this.finish();
    const wav = new Blob([wavHeader(this.bytes, this.sampleRate), ...this.chunks], { type: 'audio/wav' });
    const form = new FormData();
    form.append('files', wav, 'sample.wav');
    form.append('name', cloneName(name));
    form.append('remove_background_noise', 'true');
    form.append('description', 'Créée depuis DualCast Translate');
    let res;
    try {
      res = await fetch(`${base}/v1/voices/add`, { method: 'POST', headers: { 'xi-api-key': apiKey }, body: form });
    } catch (error) {
      throw new ApiError('ElevenLabs', 0, String(error?.message ?? error));
    }
    return parseCloneResult({ status: res.status, body: await res.text() });
  }

  async discard() {
    this.running = false;
    this.mic.setSink(null);
    await this.mic.close();
    this.chunks = [];
  }
}
