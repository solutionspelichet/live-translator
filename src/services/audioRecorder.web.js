// Web microphone recorder with the same surface as react-native-audio-api's AudioRecorder (onAudioReady / start / stop /
// clearOnAudioReady): getUserMedia → AudioContext → ScriptProcessor (deprecated but the one that works in every Safari) → mono chunks
// at the wanted rate. The browser may give 44.1 / 48 kHz whatever is asked: the audio is averaged down to the target rate here.

/** Mono block at `fromRate` → block at `toRate` (averaging the samples under each output sample: no aliasing worth speaking of for speech). */
export function downsample(input, fromRate, toRate) {
  if (!input.length) return new Float32Array(0);
  if (Math.abs(fromRate - toRate) < 1) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export class AudioRecorder {
  constructor() {
    this.callback = null;
    this.options = { sampleRate: 16000, bufferLength: 1600 };
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.pending = new Float32Array(0);
  }

  onAudioReady(options, callback) {
    this.options = { sampleRate: options.sampleRate, bufferLength: options.bufferLength };
    this.callback = callback;
  }

  clearOnAudioReady() {
    this.callback = null;
  }

  async start() {
    try {
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) return { status: 'error', message: 'Ce navigateur ne donne pas accès au micro (page non sécurisée ?)' };
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      this.ctx = new Ctx();
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      const mute = this.ctx.createGain();
      mute.gain.value = 0; // Safari only runs the processor when it is connected to the destination
      this.node.onaudioprocess = (event) => this.handle(event.inputBuffer.getChannelData(0), this.ctx.sampleRate);
      source.connect(this.node);
      this.node.connect(mute);
      mute.connect(this.ctx.destination);
      this.pending = new Float32Array(0);
      return { status: 'success' };
    } catch (error) {
      this.release();
      return { status: 'error', message: String(error?.name === 'NotAllowedError' ? 'Autorisation du micro refusée' : error?.message ?? error) };
    }
  }

  handle(block, rate) {
    if (!this.callback) return;
    const low = downsample(block, rate, this.options.sampleRate);
    const joined = new Float32Array(this.pending.length + low.length);
    joined.set(this.pending);
    joined.set(low, this.pending.length);
    const size = this.options.bufferLength;
    let at = 0;
    while (joined.length - at >= size) {
      const chunk = joined.slice(at, at + size);
      at += size;
      this.callback({ buffer: { getChannelData: () => chunk, sampleRate: this.options.sampleRate } });
    }
    this.pending = joined.slice(at);
  }

  release() {
    try {
      this.node?.disconnect();
    } catch {}
    this.stream?.getTracks?.().forEach((t) => t.stop());
    this.ctx?.close?.().catch?.(() => {});
    this.node = null;
    this.stream = null;
    this.ctx = null;
  }

  async stop() {
    this.release();
    return { status: 'success' };
  }
}
