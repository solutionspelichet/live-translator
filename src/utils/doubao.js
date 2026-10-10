// BytePlus Seed Speech — Live Interpretation (AST 2.0), speech to speech. Pure → unit-tested.
// Protocol (binary protobuf over WebSocket), as it worked in a production client:
//   StartSession (event 100) → wait for SessionStarted (150) → audio packets (event 200) → FinishSession (102) → SessionFinished (152).
//   Nothing may change after the start (languages, voice); JSON frames are refused.
import { firstOf, message, readFields, utf8Decode } from './protobuf.js';

export const DOUBAO_SAMPLE_RATE = 16000; // in and out: PCM 16-bit mono
export const DOUBAO_PACKET_BYTES = 3200; // 100 ms of audio (the service documents ~80 ms)
export const DOUBAO_TTS_RESOURCE = 'seed-icl-2.0'; // cloned voices (the only kind this client has been proven with)

const EVENT = Object.freeze({
  START: 100,
  FINISH: 102,
  STARTED: 150,
  FINISHED: 152,
  FAILED: 153,
  TASK: 200,
  MUTED: 250,
  AUDIO: 352,
  SOURCE_INTERIM: 651,
  SOURCE_FINAL: 652,
  TRANSLATION_INTERIM: 654,
  TRANSLATION_FINAL: 655,
});

// Languages of the speech-to-text list of the guide; one of the two sides must be Chinese or English.
// Only zh ↔ fr and zh → en are PROVEN in speech-to-speech: the others are tried and the service decides.
const SPOKEN = Object.freeze(['zh', 'en', 'pt', 'es', 'ja', 'id', 'de', 'fr', 'ru', 'it', 'ko', 'ar', 'tr', 'ms', 'vi', 'th', 'nl', 'ro', 'pl', 'cs']);

/** The code to ask for, or null (the app's Arabic dialects are answered in standard Arabic). */
export function doubaoCode(code) {
  const base = String(code ?? '').startsWith('ar') ? 'ar' : code;
  return SPOKEN.includes(base) ? base : null;
}

/** Why a direction cannot work, or null. `from` and `to` are Doubao codes. */
export function doubaoPairProblem(from, to) {
  if (from === to) return 'les deux langues sont identiques';
  if (!['zh', 'en'].includes(from) && !['zh', 'en'].includes(to)) return 'Doubao exige que l\'une des deux langues soit le chinois ou l\'anglais';
  return null;
}

export function startSession({ sessionId, source, target, speakerId, ttsResourceId = DOUBAO_TTS_RESOURCE }) {
  return message((w) => {
    w.bytes(1, message((m) => m.string(6, sessionId)));
    w.int32(2, EVENT.START);
    w.bytes(3, message((m) => {
      m.string(1, 'dualcast-translate');
      m.string(3, 'Android');
    }));
    w.bytes(4, message((m) => {
      m.string(4, 'wav');
      m.string(5, 'raw');
      m.int32(7, DOUBAO_SAMPLE_RATE);
      m.int32(8, 16);
      m.int32(9, 1);
    }));
    w.bytes(5, message((m) => {
      m.string(4, 'pcm');
      m.int32(7, DOUBAO_SAMPLE_RATE);
      m.int32(8, 16);
      m.int32(9, 1);
    }));
    w.bytes(6, message((m) => {
      m.string(1, 's2s');
      m.string(2, source);
      m.string(3, target);
      m.string(4, speakerId);
      m.int32(5, 0); // speech rate
      m.int32(7, 1); // custom (cloned) speaker
      m.string(8, ttsResourceId);
    }));
  });
}

export const audioPacket = (pcm16) =>
  message((w) => {
    w.int32(2, EVENT.TASK);
    w.bytes(4, message((m) => m.bytes(14, pcm16)));
  });

export const finishSession = (sessionId) =>
  message((w) => {
    w.bytes(1, message((m) => m.string(6, sessionId)));
    w.int32(2, EVENT.FINISH);
  });

/**
 * One server message → { type, … } or null for an event we do not use.
 * types: started | sourceText | translationText ({ text, final }) | audio ({ pcm16 }) | muted | finished | failed ({ code, message })
 */
export function parseServerMessage(bytes) {
  const fields = readFields(bytes);
  const event = firstOf(fields, 2);
  if (typeof event !== 'number') return null;
  const text = () => {
    const raw = firstOf(fields, 4);
    return raw instanceof Uint8Array ? utf8Decode(raw) : '';
  };
  switch (event) {
    case EVENT.STARTED:
      return { type: 'started' };
    case EVENT.SOURCE_INTERIM:
    case EVENT.SOURCE_FINAL:
      return { type: 'sourceText', text: text(), final: event === EVENT.SOURCE_FINAL };
    case EVENT.TRANSLATION_INTERIM:
    case EVENT.TRANSLATION_FINAL:
      return { type: 'translationText', text: text(), final: event === EVENT.TRANSLATION_FINAL };
    case EVENT.AUDIO: {
      const pcm16 = firstOf(fields, 3);
      return pcm16 instanceof Uint8Array && pcm16.length ? { type: 'audio', pcm16 } : null;
    }
    case EVENT.MUTED:
      return { type: 'muted' };
    case EVENT.FINISHED:
      return { type: 'finished' };
    case EVENT.FAILED: {
      const meta = firstOf(fields, 1);
      const inner = meta instanceof Uint8Array ? readFields(meta) : [];
      const code = firstOf(inner, 3);
      const detail = firstOf(inner, 4);
      return { type: 'failed', code: typeof code === 'number' ? code : 0, message: detail instanceof Uint8Array ? utf8Decode(detail) : '' };
    }
    default:
      return null;
  }
}
