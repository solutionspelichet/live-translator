import { Directory, File, FileMode, Paths, UploadType } from 'expo-file-system';

import { ApiError } from '../utils/http';
import { CLONE_MAX_SEC, cloneName, parseCloneResult } from '../utils/voiceClone';
import { pcmSeconds, wavHeader } from '../utils/wav';
import MicrophoneStreamer from './MicrophoneStreamer';

/**
 * Records a voice sample (WAV on the phone) and sends it to ElevenLabs to create an instant clone.
 * The file is deleted afterwards: only the voice id is kept (by ElevenLabs).
 */
export default class VoiceSampleRecorder {
  /** @param {{settings: object, onUpdate: (state: {seconds: number, level: number}) => void}} opts */
  constructor({ settings, onUpdate }) {
    this.settings = settings;
    this.onUpdate = onUpdate;
    this.mic = new MicrophoneStreamer();
    this.bytes = 0;
    this.sampleRate = 16000;
    this.running = false;
    this.file = null;
    this.handle = null;
  }

  get seconds() {
    return pcmSeconds(this.bytes, this.sampleRate);
  }

  async start() {
    const dir = new Directory(Paths.cache, 'voice-sample');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    this.file = new File(dir, `sample-${Date.now()}.wav`);
    this.file.create({ intermediates: true, overwrite: true });
    this.handle = this.file.open(FileMode.ReadWrite);
    this.handle.writeBytes(wavHeader(0, this.sampleRate));
    const { micSource, input, micAgc } = this.settings;
    this.mic.configure({ source: micSource, input, agc: micAgc });
    this.mic.setGain('auto');
    await this.mic.open();
    this.running = true;
    this.mic.setSink(({ pcm16, sampleRate, level }) => {
      if (!this.running) return;
      this.sampleRate = sampleRate;
      this.handle.writeBytes(new Uint8Array(pcm16));
      this.bytes += pcm16.byteLength;
      this.onUpdate?.({ seconds: this.seconds, level });
      if (this.seconds >= CLONE_MAX_SEC) this.finish().then(() => this.onUpdate?.({ seconds: this.seconds, level: 0, done: true }));
    });
  }

  /** Stop recording and finalize the WAV header. Idempotent. */
  async finish() {
    if (!this.running) return this.seconds;
    this.running = false;
    this.mic.setSink(null);
    await this.mic.close();
    try {
      this.handle.offset = 0;
      this.handle.writeBytes(wavHeader(this.bytes, this.sampleRate));
      this.handle.close();
    } catch {}
    return this.seconds;
  }

  /** Create the clone. @returns {Promise<{voiceId: string, needsVerification: boolean}>} */
  async upload({ apiKey, base, name }) {
    await this.finish();
    let result;
    try {
      result = await this.file.upload(`${base}/v1/voices/add`, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'files',
        mimeType: 'audio/wav',
        headers: { 'xi-api-key': apiKey },
        parameters: { name: cloneName(name), remove_background_noise: 'true', description: 'Créée depuis DualCast Translate' },
      });
    } catch (error) {
      throw new ApiError('ElevenLabs', 0, String(error?.message ?? error));
    }
    return parseCloneResult(result);
  }

  async discard() {
    this.running = false;
    this.mic.setSink(null);
    await this.mic.close();
    try {
      this.handle?.close();
      if (this.file?.exists) this.file.delete();
    } catch {}
  }
}
