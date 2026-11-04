import { bufferToBase64 } from '../utils/live.js';
import { applyLoudness, floatToPcm16, loudnessGain } from '../utils/pcm.js';

const DRAIN_TIMEOUT_MS = 60000;

/**
 * Plays a voice on the phone's built-in SPEAKER through the native stream (DualcastPower.speaker*), while the rest of the app's
 * audio keeps going to the headset. Same contract as AudioRoutingService.playStream: pieces are played as they arrive,
 * the promise resolves when the sentence has been heard (or was cut).
 * @param {object} power  the native wrapper (modules/dualcast-power)
 */
export default class SpeakerPlayer {
  constructor(power) {
    this.power = power;
    this.streams = new Set();
  }

  get available() {
    return !!this.power?.speakerAvailable;
  }

  /** @param {import('../utils/ttsStream.js').default} stream */
  playStream(stream, { voiceVolume = 2, prebufferSec = 0.15 } = {}) {
    const rate = stream.sampleRate ?? 24000;
    const status = String(this.power.speakerOpen(rate));
    if (!status.startsWith('ok')) return Promise.reject(new Error(`haut-parleur indisponible (${status})`));
    this.streams.add(stream);
    return new Promise((resolve, reject) => {
      let pending = [];
      let pendingLen = 0;
      let first = true;
      let gain = null; // one gain for the whole sentence, so loudness doesn't jump between pieces
      let wrote = false;
      let failure = null;

      const flush = (force) => {
        const need = (first ? prebufferSec : 0.1) * rate;
        if (!pendingLen || (!force && pendingLen < need)) return;
        const joined = new Float32Array(pendingLen);
        let offset = 0;
        for (const part of pending) {
          joined.set(part, offset);
          offset += part.length;
        }
        pending = [];
        pendingLen = 0;
        if (gain == null) gain = loudnessGain(joined, voiceVolume) ?? 1;
        this.power.speakerWrite(bufferToBase64(floatToPcm16(applyLoudness(joined, gain))));
        wrote = true;
        first = false;
      };

      const off = stream.onChunk((samples) => {
        pending.push(samples);
        pendingLen += samples.length;
        flush(false);
      });

      const end = async () => {
        off();
        if (wrote && !stream.aborted) await this.power.speakerDrain(DRAIN_TIMEOUT_MS);
        this.streams.delete(stream);
        if (failure && !stream.gotAudio) reject(failure);
        else resolve();
      };
      stream.done.then(
        () => {
          if (!stream.aborted) flush(true); // an aborted sentence must not play its leftovers
          end();
        },
        (error) => {
          if (!stream.aborted) flush(true);
          failure = error;
          end();
        },
      );
    });
  }

  /** Raw samples (a sentence already decoded): played at once, resolves when heard. */
  async playSamples(samples, rate, { voiceVolume = 2 } = {}) {
    const status = String(this.power.speakerOpen(rate));
    if (!status.startsWith('ok')) throw new Error(`haut-parleur indisponible (${status})`);
    const gain = loudnessGain(samples, voiceVolume) ?? 1;
    const piece = Math.round(rate * 0.2);
    for (let i = 0; i < samples.length; i += piece) {
      this.power.speakerWrite(bufferToBase64(floatToPcm16(applyLoudness(samples.subarray(i, i + piece), gain))));
    }
    await this.power.speakerDrain(DRAIN_TIMEOUT_MS);
  }

  /** Cut everything (the turn was cancelled). */
  stop() {
    for (const stream of [...this.streams]) stream.abort();
    this.streams.clear();
    try {
      this.power.speakerStop();
    } catch {}
  }
}
