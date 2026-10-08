import { AudioContext, AudioManager } from 'react-native-audio-api';

import { applyLoudness, boostLoudness, clampPan, loudnessGain, pcm16ToFloat, resampleLinear } from '../utils/pcm';

export const CHANNEL = Object.freeze({ LEFT: -1.0, RIGHT: 1.0 });

/**
 * Accepted audio sources (all are decoded to an AudioBuffer, then hard-panned):
 *  - { url }                          remote/local file or URL (mp3, wav…) — decoded natively
 *  - { data, encoded: true }          ArrayBuffer of an encoded file (e.g. ElevenLabs mp3_44100_128)
 *  - { data, sampleRate }             ArrayBuffer of raw 16-bit mono PCM (e.g. ElevenLabs pcm_24000)
 *                                     → fastest path: no codec, no temp file.
 */

/**
 * Plays synthesized speech with a hard stereo pan, so that one Bluetooth earbud
 * (left) only hears language A and the other (right) only language B.
 *
 * Why react-native-audio-api: expo-av / expo-audio / react-native-track-player expose
 * no pan control. This library implements the Web Audio graph natively:
 *   AudioBufferSourceNode → StereoPannerNode(pan ±1) → GainNode → destination
 * A mono source through a StereoPannerNode at pan=-1 gives L=1.0, R=0.0 (exactly silent).
 */
class AudioRoutingService {
  constructor() {
    this.ctx = null;
    this.active = new Set(); // sources currently playing, so stopAll() can cut them
    this.streams = new Set(); // TtsStream being played (stopAll aborts them)
    this.sessionReady = false;
    this.voiceVolume = 2; // loudness of the translated voice (1 = normal speech level)
  }

  setVoiceVolume(volume) {
    this.voiceVolume = volume;
  }

  /**
   * Configure the OS audio session. MUST be called once before recording or playing.
   *
   * Bluetooth pitfall: if the phone's Bluetooth *input* (HFP profile) is used while
   * recording, iOS/Android drop the headset to a mono 8–16 kHz call profile and the
   * L/R separation is lost. We therefore:
   *  - iOS: allow A2DP only (no `allowBluetoothHFP`) → mic stays the phone's own,
   *    output stays high-quality stereo A2DP.
   *  - Android: explicitly pin the input to the built-in mic (see pinBuiltInMic).
   */
  async init() {
    if (this.sessionReady) return;

    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'default',
      iosOptions: ['allowBluetoothA2DP'],
    });
    await AudioManager.setAudioSessionActivity(true);
    await this.pinBuiltInMic();

    this.ctx = new AudioContext();
    this.sessionReady = true;
  }

  async pinBuiltInMic() {
    try {
      const { availableInputs } = await AudioManager.getDevicesInfo();
      // `category` strings are platform specific; match loosely on the built-in mic.
      const builtIn = availableInputs.find((d) => /built.?in|mic(rophone)?$/i.test(`${d.category} ${d.name}`) && !/bluetooth|sco|hfp/i.test(`${d.category} ${d.name}`));
      if (builtIn) await AudioManager.setInputDevice(builtIn.id);
    } catch (err) {
      console.warn('[AudioRouting] could not pin built-in mic:', err);
    }
  }

  /** Microphones the phone currently offers: [{ id, name, category }]. */
  async listInputs() {
    try {
      const { availableInputs } = await AudioManager.getDevicesInfo();
      return availableInputs.map((d) => ({ id: d.id, name: d.name, category: d.category }));
    } catch {
      return [];
    }
  }

  /**
   * Use the chosen microphone ({ id, name }), or the phone's built-in one when `choice` is null or
   * no longer connected. Ids can change between sessions, so fall back to matching by name.
   * @returns {Promise<string|null>} id of the selected device, null if the built-in mic was used
   */
  async selectInput(choice) {
    try {
      const { availableInputs } = await AudioManager.getDevicesInfo();
      const device = choice && (availableInputs.find((d) => d.id === choice.id) ?? availableInputs.find((d) => d.name === choice.name));
      if (!device) {
        await this.pinBuiltInMic();
        return null;
      }
      await AudioManager.setInputDevice(device.id);
      return device.id;
    } catch (err) {
      console.warn('[AudioRouting] could not select the microphone:', err);
      return null;
    }
  }

  /** True when a non-speaker, non-earpiece output (Bluetooth/wired) is connected. */
  async hasHeadphones() {
    try {
      const { currentOutputs } = await AudioManager.getDevicesInfo();
      return currentOutputs.some((d) => /bluetooth|a2dp|headphone|headset/i.test(`${d.category} ${d.name}`));
    } catch {
      return true; // can't tell → don't block the user
    }
  }

  async toAudioBuffer(source) {
    if (source.url) return this.ctx.decodeAudioData(source.url);
    if (source.data && source.encoded) return this.ctx.decodeAudioData(source.data);
    if (source.data && source.sampleRate) {
      // Resample to the context's native rate ourselves: handing the engine a 24 kHz buffer
      // on a 48 kHz context played back at double speed on device.
      const rate = this.ctx.sampleRate;
      // ElevenLabs speech is fairly quiet: bring it to a comfortable loudness first.
      const loud = boostLoudness(pcm16ToFloat(source.data), this.voiceVolume);
      const samples = resampleLinear(loud, source.sampleRate, rate);
      const buffer = this.ctx.createBuffer(1, samples.length, rate);
      buffer.getChannelData(0).set(samples);
      return buffer;
    }
    throw new Error('AudioRoutingService: unsupported source (need {url} | {data, encoded} | {data, sampleRate})');
  }

  /**
   * Play ONE source on ONE channel. Resolves when playback ends.
   * @param source  see "Accepted audio sources" above
   * @param pan     -1.0 = left earbud only, +1.0 = right earbud only
   */
  async playPanned(source, pan, opts) {
    await this.init();
    return this.playDecoded(await this.toAudioBuffer(source), pan, opts);
  }

  playLeft(source, opts) {
    return this.playPanned(source, CHANNEL.LEFT, opts);
  }

  playRight(source, opts) {
    return this.playPanned(source, CHANNEL.RIGHT, opts);
  }

  /**
   * Play two streams at the same time on opposite channels (language A → left,
   * language B → right). Both are decoded first, then started together so they stay in sync.
   */
  async playDual({ left, right }, opts) {
    await this.init();
    const [bufL, bufR] = await Promise.all([this.toAudioBuffer(left), this.toAudioBuffer(right)]);
    return Promise.all([
      this.playDecoded(bufL, CHANNEL.LEFT, opts),
      this.playDecoded(bufR, CHANNEL.RIGHT, opts),
    ]);
  }

  /** Wire AudioBufferSource → StereoPanner → Gain → output and start it now. */
  playDecoded(buffer, pan, { volume = 1.0 } = {}) {
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = clampPan(pan);
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    node.connect(panner);
    panner.connect(gain);
    gain.connect(this.ctx.destination);
    return new Promise((resolve) => {
      node.onEnded = () => {
        this.active.delete(node);
        node.disconnect();
        panner.disconnect();
        gain.disconnect();
        resolve();
      };
      this.active.add(node);
      node.start();
    });
  }

  /**
   * Play a sentence that is still being synthesized (TtsStream): audio pieces are scheduled
   * back to back on the Web Audio clock as they arrive, so speech starts after ~0.3 s instead of
   * after the whole sentence is ready. Rejects only when nothing at all could be played.
   */
  async playStream(stream, pan, { volume = 1.0, prebufferSec = 0.15, rate: speed = 1 } = {}) {
    await this.init();
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const inRate = stream.sampleRate ?? 24000;
    const panner = ctx.createStereoPanner();
    panner.pan.value = clampPan(pan);
    const out = ctx.createGain();
    out.gain.value = volume;
    panner.connect(out);
    out.connect(ctx.destination);

    this.streams.add(stream);
    return new Promise((resolve, reject) => {
      let pending = [];
      let pendingLen = 0;
      let nextTime = 0;
      let running = 0;
      let finished = false;
      let failure = null;
      let voiceGain = null; // one gain for the whole sentence, so loudness doesn't jump between pieces
      let first = true;

      const settle = () => {
        if (!finished || running > 0) return;
        off();
        this.streams.delete(stream);
        panner.disconnect();
        out.disconnect();
        if (failure && !stream.gotAudio) reject(failure);
        else resolve();
      };

      const flush = (force) => {
        // Wait for a little audio before the first sound (jitter buffer), then ~0.1 s pieces.
        const need = (first ? prebufferSec : 0.1) * inRate;
        if (!pendingLen || (!force && pendingLen < need)) return;
        const joined = new Float32Array(pendingLen);
        let o = 0;
        for (const part of pending) {
          joined.set(part, o);
          o += part.length;
        }
        pending = [];
        pendingLen = 0;
        if (voiceGain == null) voiceGain = loudnessGain(joined, this.voiceVolume) ?? 1;
        const samples = resampleLinear(applyLoudness(joined, voiceGain), inRate, rate);
        const buffer = ctx.createBuffer(1, samples.length, rate);
        buffer.getChannelData(0).set(samples);
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        if (speed !== 1 && node.playbackRate) node.playbackRate.value = speed;
        node.connect(panner);
        const startAt = Math.max(nextTime, ctx.currentTime + 0.03);
        nextTime = startAt + buffer.duration / (node.playbackRate ? speed : 1);
        first = false;
        running++;
        this.active.add(node);
        node.onEnded = () => {
          this.active.delete(node);
          node.disconnect();
          running--;
          settle();
        };
        node.start(startAt);
      };

      const off = stream.onChunk((samples) => {
        pending.push(samples);
        pendingLen += samples.length;
        flush(false);
      });
      stream.done.then(
        () => {
          if (!stream.aborted) flush(true); // an aborted sentence must not play its leftovers
          finished = true;
          settle();
        },
        (err) => {
          if (!stream.aborted) flush(true);
          failure = err;
          finished = true;
          settle();
        },
      );
    });
  }

  stopAll() {
    for (const stream of [...this.streams]) stream.abort();
    for (const node of [...this.active]) {
      try {
        node.stop(); // fires onEnded → cleanup + promise resolution
      } catch {
        this.active.delete(node);
      }
    }
  }

  async dispose() {
    // Flip the flag first so a quick re-init (settings screen → back) starts a fresh session
    // instead of reusing the one being torn down.
    const ctx = this.ctx;
    this.sessionReady = false;
    this.ctx = null;
    this.stopAll();
    await ctx?.close();
    await AudioManager.setAudioSessionActivity(false);
  }
}

export default new AudioRoutingService();
