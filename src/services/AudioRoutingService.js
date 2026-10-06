import { AudioContext, AudioManager } from 'react-native-audio-api';

import { clampPan, pcm16ToFloat } from '../utils/pcm';

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
    this.sessionReady = false;
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
      const samples = pcm16ToFloat(source.data);
      const buffer = this.ctx.createBuffer(1, samples.length, source.sampleRate);
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

  stopAll() {
    for (const node of [...this.active]) {
      try {
        node.stop(); // fires onEnded → cleanup + promise resolution
      } catch {
        this.active.delete(node);
      }
    }
  }

  async dispose() {
    this.stopAll();
    await this.ctx?.close();
    this.ctx = null;
    await AudioManager.setAudioSessionActivity(false);
    this.sessionReady = false;
  }
}

export default new AudioRoutingService();
