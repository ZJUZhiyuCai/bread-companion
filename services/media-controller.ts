export interface RecorderLike {
  state: string; mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
  start: (timeslice?: number) => void; stop: () => void;
}
export interface MediaDeps {
  getUserMedia: () => Promise<MediaStream>;
  createRecorder: (stream: MediaStream) => RecorderLike;
}
const browserDeps: MediaDeps = {
  getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }),
  createRecorder: (stream) => {
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t));
    return new MediaRecorder(stream, type ? { mimeType: type } : undefined) as unknown as RecorderLike;
  }
};

/** Owns resources, not session permissions. Every callback rechecks caller's run token. */
export class MediaController {
  private generation = 0;
  private stream: MediaStream | null = null;
  private recorder: RecorderLike | null = null;
  private chunks: Blob[] = [];
  private discard = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private finished: Promise<Blob | null> | null = null;
  private resolveFinished: ((blob: Blob | null) => void) | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private endPlayback: (() => void) | null = null;
  constructor(private deps: MediaDeps = browserDeps) {}
  async start(isValid: () => boolean, tick: (seconds: number) => void, onLimit: (blob: Blob | null) => void, onError: () => void, limitSeconds = 60): Promise<boolean> {
    this.cancelRecording(); this.stopPlayback();
    const generation = this.generation;
    const stream = await this.deps.getUserMedia();
    if (generation !== this.generation || !isValid()) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream; this.discard = false; this.chunks = [];
    let recorder: RecorderLike;
    try { recorder = this.deps.createRecorder(stream); } catch (e) { this.cancelRecording(); throw e; }
    this.recorder = recorder;
    this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    const valid = () => generation === this.generation && !this.discard && isValid();
    recorder.ondataavailable = event => {
      if (!valid() || !event.data.size) return;
      this.chunks.push(event.data);
      if (this.chunks.reduce((n, b) => n + b.size, 0) > 10 * 1024 * 1024) { this.cancelRecording(); onError(); }
    };
    recorder.onstop = () => {
      if (generation !== this.generation) return;
      this.clearTimer(); this.stopTracks();
      const blob = valid() && this.chunks.length ? new Blob(this.chunks, { type: recorder.mimeType || this.chunks[0].type }) : null;
      this.chunks = []; this.resolveFinished?.(blob); this.resolveFinished = null;
    };
    recorder.onerror = () => { if (valid()) { this.cancelRecording(); onError(); } };
    try { recorder.start(250); } catch (e) { this.cancelRecording(); throw e; }
    const started = Date.now(); tick(0);
    this.timer = setInterval(() => {
      if (!valid()) { this.cancelRecording(); return; }
      const seconds = Math.floor((Date.now() - started) / 1000); tick(Math.min(seconds, limitSeconds));
      if (seconds >= limitSeconds) { void this.finish().then(blob => { if (valid()) onLimit(blob); }); }
    }, 250);
    return true;
  }
  finish(): Promise<Blob | null> {
    this.clearTimer();
    if (!this.recorder || this.discard || !this.finished) return Promise.resolve(null);
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.stopTracks();
    return this.finished;
  }
  cancelRecording() {
    // Invalidate BEFORE stop() can produce final dataavailable/stop callbacks.
    this.generation++; this.discard = true; this.clearTimer();
    const recorder = this.recorder; this.recorder = null;
    this.chunks = []; this.resolveFinished?.(null); this.resolveFinished = null; this.finished = null;
    if (recorder && recorder.state !== 'inactive') { try { recorder.stop(); } catch { /* already closed */ } }
    this.stopTracks();
  }
  private clearTimer() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  private stopTracks() { this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; }
  async play(blob: Blob, isValid: () => boolean): Promise<void> {
    this.stopPlayback(); if (!isValid()) return;
    const url = URL.createObjectURL(blob); const audio = new Audio(url);
    this.audio = audio; this.audioUrl = url;
    try {
      const ended = new Promise<void>((resolve, reject) => {
        this.endPlayback = resolve;
        audio.onended = () => resolve(); audio.onerror = () => reject(new Error('音频播放失败，可以继续阅读文字'));
      });
      // play() can reject before the media error event; attach a handler immediately.
      void ended.catch(() => {});
      if (!isValid()) return;
      await audio.play();
      if (!isValid() || this.audio !== audio) { audio.pause(); return; }
      await ended;
    } finally { if (this.audio === audio) this.stopPlayback(); }
  }
  stopPlayback() {
    const audio = this.audio; this.audio = null;
    if (audio) { audio.pause(); audio.onended = null; audio.onerror = null; audio.removeAttribute('src'); audio.load(); }
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl); this.audioUrl = null;
    this.endPlayback?.(); this.endPlayback = null;
  }
  cancel() { this.cancelRecording(); this.stopPlayback(); }
}

export function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2); const view = new DataView(buffer);
  const text = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => { const v = Math.max(-1, Math.min(1, s)); view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); });
  return buffer;
}
export async function normalizeRecording(blob: Blob, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  // MiniMax does not document WebM support; decode browser containers locally and send 16 kHz mono WAV.
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer()); signal.throwIfAborted();
    if (!decoded.duration || decoded.duration > 65) throw new Error('录音超过一分钟，请缩短后再试');
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering(); signal.throwIfAborted();
    return new File([encodeWav(rendered.getChannelData(0))], 'recording.wav', { type: 'audio/wav' });
  } finally { await context.close(); }
}
