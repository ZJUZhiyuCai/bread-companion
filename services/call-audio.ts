import { encodeWav } from './media-controller';
import { resampleMono, VoiceActivity } from './voice-activity';
import { PlaybackEchoGuard, speechLikeFrame } from './playback-echo';

export interface CallAudioEvents {
  meter: (level: number, heardSpeech: boolean) => void;
  utterance: (file: File) => void;
  failure: (message: string) => void;
  speechStart?: () => void;
}
export interface CallAudioPort {
  open: (events: CallAudioEvents) => Promise<boolean>;
  listen: (enabled: boolean, options?: { interruptible?: boolean; preserve?: boolean }) => void;
  finish: () => void;
  play: (blob: Blob, signal: AbortSignal, onStart: () => void) => Promise<void>;
  stopPlayback: () => void;
  close: () => void;
}

export class BrowserCallAudio implements CallAudioPort {
  private generation = 0;
  private captureEpoch = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private capture: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private playback: AudioBufferSourceNode | null = null;
  private resolvePlayback: (() => void) | null = null;
  private detector: VoiceActivity | null = null;
  private listening = false;
  private interruptible = false;
  private echo = new PlaybackEchoGuard();
  private events: CallAudioEvents | null = null;

  async open(events: CallAudioEvents): Promise<boolean> {
    this.close(); const generation = this.generation;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') throw new Error('这个浏览器暂时不能接通语音，可以继续打字。');
    // Created/resumed synchronously inside the user's click, before permission/network awaits.
    const context = new AudioContext(); this.context = context;
    const resumed = context.resume(); void resumed.catch(() => {});
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false }); }
    catch { if (generation === this.generation) this.close(); throw new Error('还没能打开麦克风。允许麦克风后可以重试，也可以继续打字。'); }
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream; stream.getAudioTracks().forEach(t => { t.enabled = false; t.onended = () => events.failure('麦克风断开了，重新接通后再说。'); });
    try {
      await resumed; await context.audioWorklet.addModule('/call-capture.js');
      if (generation !== this.generation) return false;
      const capture = new AudioWorkletNode(context, 'bread-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1 });
      this.capture = capture; this.source = context.createMediaStreamSource(stream);
      this.source.connect(capture); capture.connect(context.destination);
      this.detector = new VoiceActivity(context.sampleRate); this.events = events;
      capture.onprocessorerror = () => events.failure('声音处理暂时中断了，可以重试或打字。');
      capture.port.onmessage = ({ data }: MessageEvent<{ samples: Float32Array; epoch: number; at: number }>) => {
        if (generation !== this.generation || !this.listening || data.epoch !== this.captureEpoch || !(data.samples instanceof Float32Array)) return;
        const isEcho = this.echo.isEcho(data.samples, data.at);
        const frame = isEcho ? new Float32Array(data.samples.length) : data.samples;
        const result = this.detector!.push(frame, !this.interruptible || speechLikeFrame(frame));
        if (result.speechStarted) events.speechStart?.();
        if (generation !== this.generation || !this.listening) return;
        events.meter(result.level, result.heardSpeech);
        if (result.utterance) this.submit(result.utterance);
      };
      return true;
    } catch (e) { if (generation === this.generation) this.close(); throw e; }
  }
  listen(enabled: boolean, options: { interruptible?: boolean; preserve?: boolean } = {}) {
    const preserve = enabled && this.listening && options.preserve;
    this.listening = enabled; this.interruptible = !!options.interruptible;
    if (!preserve) { this.captureEpoch++; this.detector?.reset(); }
    this.stream?.getAudioTracks().forEach(t => { t.enabled = enabled; });
    if (!preserve) { this.capture?.port.postMessage({ armed: enabled, epoch: this.captureEpoch }); this.events?.meter(0, false); }
  }
  private submit(samples: Float32Array) {
    if (!this.listening || this.interruptible || !this.context) return;
    const pcm = resampleMono(samples, this.context.sampleRate); this.listen(false);
    this.events?.utterance(new File([encodeWav(pcm)], 'call-turn.wav', { type: 'audio/wav' }));
  }
  finish() { if (!this.listening) return; const samples = this.detector?.finish(); if (samples) this.submit(samples); }
  async play(blob: Blob, signal: AbortSignal, onStart: () => void): Promise<void> {
    const context = this.context; if (!context) throw new Error('声音连接已暂停，请继续通话。');
    this.stopPlayback(); signal.throwIfAborted();
    const decoded = await context.decodeAudioData(await blob.arrayBuffer()); signal.throwIfAborted();
    if (context !== this.context) return;
    if (context.state !== 'running') await context.resume(); signal.throwIfAborted();
    const source = context.createBufferSource(); source.buffer = decoded; source.connect(context.destination); this.playback = source;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (error?: unknown) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); if (this.playback === source) { this.playback = null; this.resolvePlayback = null; } source.disconnect(); if (error) reject(error); else resolve(); };
      const abort = () => { try { source.stop(); } catch { /* already stopped */ } done(); };
      this.resolvePlayback = () => done(); source.onended = () => done(); signal.addEventListener('abort', abort, { once: true });
      try { signal.throwIfAborted(); const start = context.currentTime; this.echo.attach(decoded.getChannelData(0), decoded.sampleRate, start); source.start(start); onStart(); } catch (e) { done(e); }
    });
    signal.throwIfAborted();
  }
  stopPlayback() {
    if (this.context) this.echo.stop(this.context.currentTime);
    const source = this.playback; this.playback = null;
    if (source) { try { source.stop(); } catch { /* already stopped */ } }
    this.resolvePlayback?.(); this.resolvePlayback = null;
  }
  close() {
    this.generation++; this.listening = false; this.captureEpoch++; this.stopPlayback();
    if (this.capture) { this.capture.port.onmessage = null; this.capture.onprocessorerror = null; this.capture.disconnect(); this.capture.port.close(); }
    this.capture = null; this.source?.disconnect(); this.source = null;
    this.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.stream = null;
    const context = this.context; this.context = null; if (context && context.state !== 'closed') void context.close().catch(() => {});
    this.detector = null; this.events = null; this.echo.clear();
  }
}

/** A resumed sentence can arrive before ASR completes; retain its earlier audio instead of losing it. */
export async function joinCallUtterances(first: Promise<File>, second: File): Promise<File> {
  const a = new DataView(await (await first).arrayBuffer()), b = new DataView(await second.arrayBuffer());
  const lengthA = (a.byteLength - 44) / 2, lengthB = (b.byteLength - 44) / 2, gap = 1600;
  if (lengthA + lengthB + gap > 16000 * 55) throw new Error('这一段有点长，可以拆成两句说。');
  const pcm = new Float32Array(lengthA + gap + lengthB);
  for (let i = 0; i < lengthA; i++) pcm[i] = a.getInt16(44 + i * 2, true) / 32768;
  for (let i = 0; i < lengthB; i++) pcm[lengthA + gap + i] = b.getInt16(44 + i * 2, true) / 32768;
  return new File([encodeWav(pcm)], 'call-turn.wav', { type: 'audio/wav' });
}
