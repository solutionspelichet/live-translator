// Minimal WAV (RIFF) support: meetings are saved as 16-bit mono PCM so the file can be sent as is to
// the speech recognizer for a more accurate second pass.

/** 44-byte header for `dataBytes` of PCM. Use 0 while recording, then patch with the real size. */
export function wavHeader(dataBytes, sampleRate = 16000, channels = 1, bits = 16) {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const write = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  const blockAlign = (channels * bits) / 8;
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bits, true);
  write(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
}

/** Duration in seconds of `dataBytes` of 16-bit mono PCM. */
export const pcmSeconds = (dataBytes, sampleRate = 16000) => dataBytes / 2 / sampleRate;

/** Approximate size of a recording, to warn about storage and upload time. */
export const wavMegabytes = (seconds, sampleRate = 16000) => (seconds * sampleRate * 2) / 1e6;
