import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { env } from '../config/env';
import { wavHeader } from '../utils/wav';
import { audioFileName } from '../utils/wordCard';
import audio from './AudioRoutingService';
import ElevenLabsClient from './tts/ElevenLabsClient';
import UsageTracker from './UsageTracker';

function wordsDir() {
  const dir = new Directory(Paths.document, 'words');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** The voice configured for the language: A's voice for the A language, else B's (each falls back on the other). */
export const voiceFor = (lang, languages) => {
  const base = (c) => String(c ?? '').toLowerCase().split('-')[0];
  return base(lang) === base(languages.A) ? env.voiceA || env.voiceB : env.voiceB || env.voiceA;
};

/** Spoken `text` as 16-bit PCM {data: ArrayBuffer, sampleRate}. Counted in 📊. */
export async function synthesizeWord(text, lang, voiceId) {
  const r = await new ElevenLabsClient().synthesize(text, { voiceId, language: lang });
  UsageTracker.add({ elevenChars: text.length });
  return r;
}

/** Writes the sound of a card as a WAV file on the phone and returns its uri. */
export function saveWordAudio(card, pcm) {
  const bytes = new Uint8Array(pcm.data);
  const file = new File(wordsDir(), `${card.id.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60)}.wav`);
  file.create({ intermediates: true, overwrite: true });
  const handle = file.open(FileMode.ReadWrite);
  handle.writeBytes(wavHeader(bytes.length, pcm.sampleRate));
  handle.writeBytes(bytes);
  handle.close();
  return file.uri;
}

/** The saved sound of a card as {data, sampleRate} PCM, or null when the file is gone. */
export function loadWordAudio(card) {
  try {
    if (!card.audioUri) return null;
    const file = new File(card.audioUri);
    if (!file.exists) return null;
    const handle = file.open(FileMode.ReadOnly);
    const bytes = handle.readBytes(file.size);
    handle.close();
    if (bytes.length <= 44) return null;
    const rate = new DataView(bytes.buffer, bytes.byteOffset, 44).getUint32(24, true);
    return { data: bytes.slice(44).buffer, sampleRate: rate };
  } catch {
    return null;
  }
}

export function deleteWordAudio(card) {
  try {
    if (card.audioUri) {
      const file = new File(card.audioUri);
      if (file.exists) file.delete();
    }
  } catch {}
}

/** Plays a sound at normal or slow speed (the voice-speed setting does not apply to a pronunciation). */
export function playWord(pcm, { slow = false } = {}) {
  audio.stopAll();
  return audio.playPanned({ data: pcm.data, sampleRate: pcm.sampleRate, speed: slow ? 0.75 : 1 }, 0);
}

export function stopWord() {
  audio.stopAll();
}

/** Opens the share sheet with the WAV file (Drive, WhatsApp, "Enregistrer"…). */
export async function shareWordAudio(card, pcm) {
  const uri = card.audioUri && new File(card.audioUri).exists ? card.audioUri : saveWordAudio(card, pcm);
  const named = new File(wordsDir(), audioFileName(card));
  if (named.exists) named.delete();
  new File(uri).copy(named);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Le partage de fichiers n’est pas disponible sur cet appareil.');
  await Sharing.shareAsync(named.uri, { mimeType: 'audio/wav', dialogTitle: card.translated, UTI: 'com.microsoft.waveform-audio' });
}
