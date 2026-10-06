import { AudioManager, AudioRecorder } from 'react-native-audio-api';

import { floatToPcm16 } from '../utils/pcm';

const TARGET_RATE = 16000; // plenty for speech, a third of the bandwidth of 48 kHz
const CHUNK_MS = 100; // small chunks keep STT latency low

/** Streams the phone's microphone as 16-bit mono PCM chunks. */
export default class MicrophoneStreamer {
  constructor() {
    this.recorder = new AudioRecorder();
    this.running = false;
  }

  async ensurePermission() {
    let status = await AudioManager.checkRecordingPermissions();
    if (status !== 'Granted') status = await AudioManager.requestRecordingPermissions();
    if (status !== 'Granted') throw new Error('Microphone permission denied');
  }

  /** @param {(chunk: {pcm16: ArrayBuffer, sampleRate: number}) => void} onChunk */
  async start(onChunk) {
    await this.ensurePermission();
    this.recorder.onAudioReady(
      { sampleRate: TARGET_RATE, bufferLength: (TARGET_RATE * CHUNK_MS) / 1000, channelCount: 1 },
      ({ buffer }) => {
        // The OS may not honour the requested rate: report the real one so the
        // consumer can declare it to Deepgram.
        onChunk({ pcm16: floatToPcm16(buffer.getChannelData(0)), sampleRate: buffer.sampleRate });
      },
    );
    const res = await this.recorder.start();
    if (res.status === 'error') throw new Error(`Recorder failed: ${res.message}`);
    this.running = true;
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    this.recorder.clearOnAudioReady();
    await this.recorder.stop();
  }
}
