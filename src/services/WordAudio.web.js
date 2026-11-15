import { env } from '../config/env';
import { wavHeader } from '../utils/wav';
import { audioFileName } from '../utils/wordCard';
import audio from './AudioRoutingService';
import ElevenLabsClient from './tts/ElevenLabsClient';
import UsageTracker from './UsageTracker';

export const voiceFor = (lang, languages) => {
  const base = (c) => String(c ?? '').toLowerCase().split('-')[0];
  return base(lang) === base(languages.A) ? env.voiceA || env.voiceB : env.voiceB || env.voiceA;
};

export async function synthesizeWord(text, lang, voiceId) {
  const r = await new ElevenLabsClient().synthesize(text, { voiceId, language: lang });
  UsageTracker.add({ elevenChars: text.length });
  return r;
}

// The browser keeps no sound file with the card: it is generated again when needed (a few characters).
export const saveWordAudio = () => undefined;
export const loadWordAudio = () => null;
export const deleteWordAudio = () => {};

export function playWord(pcm, { slow = false } = {}) {
  audio.stopAll();
  return audio.playPanned({ data: pcm.data, sampleRate: pcm.sampleRate, speed: slow ? 0.75 : 1 }, 0);
}

export function stopWord() {
  audio.stopAll();
}

/** Share sheet (iPhone) or download of the WAV file. */
export async function shareWordAudio(card, pcm) {
  const bytes = new Uint8Array(pcm.data);
  const blob = new Blob([wavHeader(bytes.length, pcm.sampleRate), bytes], { type: 'audio/wav' });
  const name = audioFileName(card);
  const file = typeof File === 'function' ? new File([blob], name, { type: 'audio/wav' }) : null;
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: card.translated });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
