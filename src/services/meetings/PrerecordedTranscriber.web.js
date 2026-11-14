import { env } from '../../config/env';
import { ApiError } from '../../utils/http';
import { parsePrerecorded } from '../../utils/diarize';
import { getBlob } from '../../utils/blobStore';
import { prerecordedModels, prerecordedParams } from '../../utils/meeting';

/** Web version: the recording (a Blob in IndexedDB) is posted to Deepgram's pre-recorded API with progress reporting. */
function post(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Token ${env.deepgramKey}`);
    xhr.setRequestHeader('Content-Type', 'audio/wav');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new Error('réseau indisponible'));
    xhr.send(blob);
  });
}

export async function transcribeRecording(audioUri, { language, onProgress }) {
  const blob = await getBlob(audioUri);
  if (!blob) throw new Error("L'enregistrement audio de cette réunion n'existe plus dans ce navigateur.");
  let lastError = null;
  for (const model of prerecordedModels(language)) {
    const url = `${env.deepgramHttpUrl}?${prerecordedParams({ language, model })}`;
    let result;
    try {
      result = await post(url, blob, onProgress);
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
    if (result.status !== 400 && result.status !== 422) break;
  }
  throw lastError;
}
