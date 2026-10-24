/**
 * One DIRECTION of the Mistral pipeline, with the same surface as the other live sessions (the engine holds any of them).
 * The real work is done once per turn by the shared MistralLiveHub: the session that transcribes (`transcribeInput`) feeds
 * and closes it, every session receives the sentences the hub routes to its direction (`source` → `target`).
 */
export default class MistralLiveSession {
  constructor({ target, source, transcribeInput = false, hub, onAudio, onInputText, onOutputText, onStatus, onNote, onError, onUsage }) {
    Object.assign(this, { target, source, transcribeInput, hub, onAudio, onInputText, onOutputText, onStatus, onNote, onError, onUsage });
    this.status = 'connecting';
  }

  connect() {
    this.hub.addSession(this);
    if (this.transcribeInput) this.hub.connect();
  }

  sendAudio(base64Pcm16) {
    if (this.transcribeInput) this.hub.sendAudio(base64Pcm16);
  }

  close() {
    return this.transcribeInput ? this.hub.close() : Promise.resolve();
  }

  abort() {
    if (this.transcribeInput) this.hub.abort();
  }
}
