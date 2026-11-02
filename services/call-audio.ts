import { encodeWav } from './media-controller';
import { resampleMono, VoiceActivity } from './voice-activity';
import { PlaybackEchoGuard, speechLikeFrame } from './playback-echo';
import { startDialTone } from './dial-tone';
import { CaptureHealth } from './capture-health';
import { withAbort } from '@/lib/abort';
import type { MPEGDecoder } from 'mpg123-decoder';
import { createSpeechDecoder, warmSpeechDecoder } from './speech-decoder';
import { SpeechChunks, type CallSpeech } from './speech-stream';

export function microphoneRecoveryHint(userAgent = navigator.userAgent): string {
  return /MicroMessenger/i.test(userAgent)
    ? '在微信右上角“···”选择“在浏览器打开”，再允许浏览器使用麦克风。'
    : '检查浏览器的麦克风权限后重试，也可以用手机自带浏览器打开。';
}

export interface CallAudioEvents {
  meter: (level: number, heardSpeech: boolean) => void;
  utterance: (file: File) => void;
  failure: (message: string) => void;
  speechStart?: () => void;
  inputWarning?: (message: string) => void;
}
export interface CallAudioPort {
  open: (events: CallAudioEvents) => Promise<boolean>;
  listen: (enabled: boolean, options?: { interruptible?: boolean; preserve?: boolean }) => void;
  finish: () => void;
  play: (blob: CallSpeech, signal: AbortSignal, onStart: () => void) => Promise<void>;
  stopPlayback: () => void;
  stopDialTone?: () => void;
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
  private cancelStream: (() => void) | null = null;
  private resolvePlayback: (() => void) | null = null;
  private detector: VoiceActivity | null = null;
  private listening = false;
  private interruptible = false;
  private echo = new PlaybackEchoGuard();
  private events: CallAudioEvents | null = null;
  private health = new CaptureHealth();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private inputWarning = '';
  private stopRingback: (() => void) | null = null;
  stopDialTone = () => { this.stopRingback?.(); this.stopRingback = null; };

  async open(events: CallAudioEvents): Promise<boolean> {
    this.close(); const generation = this.generation;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') throw new Error('这个浏览器暂时不能接通语音。' + microphoneRecoveryHint());
    // Created/resumed synchronously inside the user's click, before permission/network awaits.
    const context = new AudioContext(); this.context = context;
    warmSpeechDecoder();
    const resumed = context.resume(); void resumed.catch(() => {});
    this.stopRingback = startDialTone(context);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false }); }
    catch { if (generation === this.generation) this.close(); throw new Error('还没能打开麦克风。' + microphoneRecoveryHint()); }
    if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream; stream.getAudioTracks().forEach(t => { t.enabled = false; t.onended = () => events.failure('麦克风断开了，重新接通后再说。'); });
    try {
      await resumed; await context.audioWorklet.addModule('/call-capture.js');
      if (generation !== this.generation) return false;
      if (context.state !== 'running') throw new Error('声音连接暂停了，重新接通后再说。');
      // The OS can interrupt audio without hiding the page or ending a track.
      // A frozen audio graph must not leave the UI listening with a live mic.
      context.onstatechange = () => {
        if (generation === this.generation && context === this.context && context.state !== 'running') {
          events.failure('声音连接暂停了，重新接通后再说。');
        }
      };
      const capture = new AudioWorkletNode(context, 'bread-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1 });
      this.capture = capture; this.source = context.createMediaStreamSource(stream);
      this.source.connect(capture); capture.connect(context.destination);
      this.detector = new VoiceActivity(context.sampleRate); this.events = events;
      capture.onprocessorerror = () => events.failure('声音处理暂时中断了，可以重试或打字。');
      capture.port.onmessage = ({ data }: MessageEvent<{ samples: Float32Array; epoch: number; at: number }>) => {
        if (generation !== this.generation || !this.listening || data.epoch !== this.captureEpoch || !(data.samples instanceof Float32Array)) return;
        this.health.frame(data.samples, performance.now());
        const isEcho = this.echo.isEcho(data.samples, data.at);
        const frame = isEcho ? new Float32Array(data.samples.length) : data.samples;
        const result = this.detector!.push(frame, speechLikeFrame(frame, this.interruptible ? .009 : .002));
        if (result.speechStarted) events.speechStart?.();
        if (generation !== this.generation || !this.listening) return;
        events.meter(result.level, result.heardSpeech);
        if (result.utterance) this.submit(result.utterance);
      };
      this.healthTimer = setInterval(() => {
        if (generation !== this.generation || !this.listening) return;
        const state = this.health.check(performance.now(), !!this.stream?.getAudioTracks().some(t => t.muted));
        if (state === 'stalled' || state === 'muted') {
          // Close first, even when an embedding host doesn't close in its failure callback.
          this.close();
          events.failure((state === 'muted' ? '麦克风被浏览器暂停了。' : '没有收到麦克风声音。') + microphoneRecoveryHint());
          return;
        }
        const warning = state === 'silent' ? '还没收到声音；如果你正在说话，' + microphoneRecoveryHint() : '';
        if (warning !== this.inputWarning) { this.inputWarning = warning; events.inputWarning?.(warning); }
      }, 500);
      return true;
    } catch (e) { if (generation === this.generation) this.close(); throw e; }
  }
  listen(enabled: boolean, options: { interruptible?: boolean; preserve?: boolean } = {}) {
    const preserve = enabled && this.listening && options.preserve;
    if (enabled && !this.listening) this.health.reset(performance.now());
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
  async play(blob: CallSpeech, signal: AbortSignal, onStart: () => void): Promise<void> {
    const context = this.context; if (!context) throw new Error('声音连接已暂停，请继续通话。');
    this.stopPlayback(); signal.throwIfAborted();
    if (blob instanceof SpeechChunks) {
      const preparing = new AbortController(), cancel = () => preparing.abort();
      this.cancelStream = cancel; signal = AbortSignal.any([signal, preparing.signal]);
      try {
        const decoder = blob.kind === 'mp3' ? await createSpeechDecoder(signal) : null;
        if (context !== this.context) { decoder?.free(); return; }
        if (blob.kind !== 'mp3' || decoder) return this.playPcm(blob, signal, onStart, decoder);
        // No second synthesis if the optional decoder cannot initialize.
        const chunks: Uint8Array<ArrayBuffer>[] = [], iterator = blob[Symbol.asyncIterator]();
        try {
          for (;;) { const item = await withAbort(iterator.next(), signal); if (item.done) break; chunks.push(new Uint8Array(item.value)); }
        } finally { if (signal.aborted) blob.fail(signal.reason); void iterator.return?.().catch(() => {}); }
        blob = new Blob(chunks, { type: 'audio/mpeg' });
      } finally { if (this.cancelStream === cancel) this.cancelStream = null; }
    }
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
  private async playPcm(stream: SpeechChunks, parent: AbortSignal, onStart: () => void, decoder: MPEGDecoder | null) {
    const context = this.context!;
    const canceled = new AbortController(), signal = AbortSignal.any([parent, canceled.signal]);
    const cancel = () => canceled.abort(); this.cancelStream = cancel;
    const sources = new Set<AudioBufferSourceNode>();
    const iterator = stream[Symbol.asyncIterator]();
    let tail = Promise.resolve(), nextAt = context.currentTime + .06, started = false, samples = 0;
    try {
      if (context.state !== 'running') await withAbort(context.resume(), signal);
      for (;;) {
        const item = await withAbort(iterator.next(), signal); signal.throwIfAborted();
        if (item.done) break;
        if (context !== this.context) throw new DOMException('Call closed', 'AbortError');
        let pcm: Float32Array;
        if (decoder) {
          const decoded = decoder.decode(item.value);
          if (decoded.errors.length) throw new Error('声音数据没有完整接上。');
          if (!decoded.samplesDecoded) continue;
          if (decoded.sampleRate !== stream.sampleRate || !decoded.channelData[0]) throw new Error('声音格式没有对应上。');
          pcm = decoded.channelData[0];
        } else {
          const bytes = item.value, view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          pcm = new Float32Array(bytes.length / 2);
          for (let i = 0; i < pcm.length; i++) pcm[i] = view.getInt16(i * 2, true) / 32768;
        }
        samples += pcm.length;
        if (samples > stream.sampleRate * 65) throw new Error('声音片段过长。');
        const buffer = context.createBuffer(1, pcm.length, stream.sampleRate);
        buffer.getChannelData(0).set(pcm);
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); sources.add(source);
        // A small scheduling cushion absorbs transport jitter, without waiting for the whole reply.
        const start = Math.max(nextAt, context.currentTime + .06); nextAt = start + buffer.duration;
        const reference = resampleMono(pcm, stream.sampleRate, context.sampleRate);
        if (!started) this.echo.attach(reference, context.sampleRate, start);
        else this.echo.append(reference, context.sampleRate, start);
        tail = new Promise<void>(resolve => { source.onended = () => { source.disconnect(); sources.delete(source); resolve(); }; });
        source.start(start);
        if (!started) { started = true; onStart(); }
      }
      if (!started) throw new Error('声音数据没有完整接上。');
      await withAbort(tail, signal);
    } finally {
      const owned = this.cancelStream === cancel;
      if (owned) this.cancelStream = null;
      // An interrupted/stalled stream must stop every scheduled chunk, not just the current one.
      for (const source of sources) { source.onended = null; try { source.stop(); } catch { /* already ended */ } source.disconnect(); }
      if (owned && context === this.context) this.echo.stop(context.currentTime);
      // Wake the iterator too; no pending queue/listener may outlive this turn.
      if (signal.aborted) stream.fail(signal.reason);
      void iterator.return?.().catch(() => {});
      decoder?.free();
    }
  }
  stopPlayback() {
    this.cancelStream?.(); this.cancelStream = null;
    this.stopDialTone();
    if (this.context) this.echo.stop(this.context.currentTime);
    const source = this.playback; this.playback = null;
    if (source) { try { source.stop(); } catch { /* already stopped */ } }
    this.resolvePlayback?.(); this.resolvePlayback = null;
  }
  close() {
    if (this.healthTimer) clearInterval(this.healthTimer); this.healthTimer = null;
    this.inputWarning = '';
    this.generation++; this.listening = false; this.captureEpoch++; this.stopPlayback();
    if (this.capture) { this.capture.port.onmessage = null; this.capture.onprocessorerror = null; this.capture.disconnect(); this.capture.port.close(); }
    this.capture = null; this.source?.disconnect(); this.source = null;
    this.stream?.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.stream = null;
    const context = this.context; this.context = null;
    if (context) {
      context.onstatechange = null;
      if (context.state !== 'closed') void context.close().catch(() => {});
    }
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
