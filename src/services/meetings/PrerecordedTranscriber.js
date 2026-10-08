import { File, UploadType } from 'expo-file-system';

import { env } from '../../config/env';
import { ApiError } from '../../utils/http';
import { parsePrerecorded } from '../../utils/diarize';
import { prerecordedModels, prerecordedParams } from '../../utils/meeting';

/**
 * Second, more accurate pass: the whole recording is sent to Deepgram's pre-recorded API (Nova-3 when the language
 * allows it) which sees the full context and separates speakers much better than the live stream.
 * The WAV file is uploaded straight from the disk (no memory copy).
 * @returns {Promise<{segments: object[], durationSec: number, model: string}>}
 */
export async function transcribeRecording(audioUri, { language, onProgress }) {
  const file = new File(audioUri);
  if (!file.exists) throw new Error("Le fichier audio de cette réunion n'existe plus sur le téléphone.");
  let lastError = null;
  for (const model of prerecordedModels(language)) {
    const url = `${env.deepgramHttpUrl}?${prerecordedParams({ language, model })}`;
    let result;
    try {
      result = await file.upload(url, {
        httpMethod: 'POST',
        uploadType: UploadType.BINARY_CONTENT,
        headers: { Authorization: `Token ${env.deepgramKey}`, 'Content-Type': 'audio/wav' },
        mimeType: 'audio/wav',
        onProgress: ({ bytesSent, totalBytes }) => onProgress?.(totalBytes > 0 ? bytesSent / totalBytes : 0),
      });
    } catch (error) {
      throw new ApiError('Deepgram', 0, String(error?.message ?? error));
    }
    if (result.status >= 200 && result.status < 300) {
      let json;
      try {
        json = JSON.parse(result.body);
      } catch {
        throw new ApiError('Deepgram', 502, 'réponse illisible');
      }
      return { ...parsePrerecorded(json), model };
    }
    lastError = new ApiError('Deepgram', result.status, String(result.body).slice(0, 300));
    // A refused model/language pair (400/422) → try the next model; anything else is final.
    if (result.status !== 400 && result.status !== 422) break;
  }
  throw lastError;
}
