import type { CallSpeech } from './speech-stream';
import type { CallState } from '@/domain/types';
import { BrowserCallAudio, joinCallUtterances, type CallAudioPort } from './call-audio';
import { CallServiceError } from './call-error';

export const CALL_IDLE_MS = 5 * 60000;

export const idleCall = (): CallState => ({ active: false, phase: 'idle', muted: false, elapsedSeconds: 0, level: 0, heardSpeech: false, lastHeard: '', caption: '', error: '' });
export interface CallDeps {
  update: (state: CallState) => void;
  transcribe: (file: File, signal: AbortSignal) => Promise<string>;
  reply: (text: string, signal: AbortSignal) => Promise<string | null>;
  synthesize: (text: string, signal: AbortSignal) => Promise<CallSpeech>;
  prepareGreeting?: (signal: AbortSignal) => Promise<Blob | null>;
  cancelReply: () => void;
}

/** One call owns one audio session. Every await is invalidated by hangup/pause/interrupt. */
export class CallController {
  private state = idleCall();
  private generation = 0;
  private turn = 0;
  private pending: AbortController | null = null;
  private opening: AbortController | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private lastMeterAt = -Infinity;
  private untranscribed: Promise<File> | null = null;
  private continuation: Promise<File> | null = null;
  private turnWarning = '';
  constructor(private deps: CallDeps, private audio: CallAudioPort = new BrowserCallAudio()) {}
  get snapshot() { return this.state; }
  private patch(patch: Partial<CallState>) { this.state = { ...this.state, ...patch }; this.deps.update(this.state); }
  private clearIdle() { if (this.idle) clearTimeout(this.idle); this.idle = null; }
  private cancelTurn(preserveCapture = false) { this.turn++; this.pending?.abort(); this.pending = null; this.opening?.abort(); this.opening = null; this.clearIdle(); if (!preserveCapture) this.audio.listen(false); this.audio.stopPlayback(); this.deps.cancelReply(); }
  private monitor() { this.audio.listen(!this.state.muted, { interruptible: true }); }
  private clearAudio() { this.untranscribed = this.continuation = null; }
  async start(greeting = '') {
    if (this.state.active) return;
    this.state = idleCall(); this.clearAudio(); this.startedAt = Date.now();
    this.patch({ active: true, phase: 'connecting' });
    this.clock = setInterval(() => { if (this.state.active) this.patch({ elapsedSeconds: Math.floor((Date.now() - this.startedAt) / 1000) }); }, 1000);
    await this.connect(greeting);
  }
  private async connect(greeting = '') {
    this.turnWarning = '';
    const generation = ++this.generation;
    let openingTurn = this.turn;
    const valid = () => this.state.active && generation === this.generation;
    this.patch({ phase: 'connecting', error: '', inputWarning: '', level: 0, heardSpeech: false });
    const opening = new AbortController(); this.opening?.abort(); this.opening = opening;
    // Only a fixed public asset is prepared in parallel; no paid synthesis before mic approval.
    const prepared = greeting && this.deps.prepareGreeting ? Promise.resolve().then(() => this.deps.prepareGreeting!(opening.signal)).catch(() => null) : Promise.resolve(null);
    try {
      const opened = await this.audio.open({
        meter: (level, heardSpeech) => {
          const now = performance.now();
          // Audio/VAD still runs every frame. Only decorative UI levels are limited to 12.5 Hz.
          if (valid() && (heardSpeech !== this.state.heardSpeech || now - this.lastMeterAt >= 80)) {
            this.lastMeterAt = now; this.patch({ level, heardSpeech });
          }
        },
        utterance: file => { if (valid() && this.state.phase === 'listening' && !this.state.muted) void this.process(file); },
        failure: message => { if (valid()) this.fail(new Error(message)); },
        inputWarning: message => { if (valid()) this.patch({ inputWarning: message || this.turnWarning }); },
        speechStart: () => { if (valid()) this.onSpeechStart(); },
      });
      if (!opened || !valid()) return;
      // Finish local ringback before enabling capture; it must not masquerade as user speech.
      this.audio.stopDialTone?.();
      if (greeting) {
        const turn = ++this.turn; openingTurn = turn; const pending = new AbortController(); this.pending = pending;
        this.patch({ caption: greeting, phase: 'connecting' });
        this.monitor();
        const cached = await prepared;
        if (!valid() || turn !== this.turn) return;
        if (cached) await this.audio.play(cached, pending.signal, () => { if (valid() && turn === this.turn) this.patch({ phase: 'speaking' }); });
        else await this.say(greeting, pending.signal, () => valid() && turn === this.turn);
        if (!valid() || turn !== this.turn) return;
      }
      this.listen(true);
    } catch (e) { if (valid() && openingTurn === this.turn) this.fail(e); }
    finally { opening.abort(); if (this.opening === opening) this.opening = null; }
  }
  private listen(preserveCapture = false) {
    if (!this.state.active) return;
    this.turnWarning = '';
    this.clearIdle();
    this.audio.stopDialTone?.();
    this.patch({ phase: this.state.muted ? 'muted' : 'listening', level: 0, heardSpeech: false, error: '', inputWarning: '' });
    if (this.state.muted) this.audio.listen(false);
    else if (preserveCapture) this.audio.listen(true, { preserve: true });
    else this.audio.listen(true);
    if (!this.state.muted) this.idle = setTimeout(() => this.pause('有一会儿没说话了，麦克风已暂停。想说时再继续。'), CALL_IDLE_MS);
  }
  private async process(file: File) {
    this.clearIdle();
    this.turnWarning = '';
    let stage: 'transcribe' | 'reply' | 'speech' = 'transcribe';
    const generation = this.generation, turn = ++this.turn;
    this.pending?.abort(); const pending = new AbortController(); this.pending = pending;
    const valid = () => this.state.active && this.generation === generation && this.turn === turn && !pending.signal.aborted;
    const audio = this.continuation ? joinCallUtterances(this.continuation, file) : Promise.resolve(file);
    this.continuation = null; this.untranscribed = audio;
    this.patch({ phase: 'transcribing', level: 0, heardSpeech: false, error: '', inputWarning: '' }); this.monitor();
    try {
      const utterance = await audio; if (!valid()) return;
      const text = (await this.deps.transcribe(utterance, pending.signal)).trim(); if (!valid()) return;
      if (!text) {
        this.untranscribed = null; this.listen();
        this.patch({ inputWarning: '这句没听清，可以再说一次。' });
        return;
      }
      if (text.length > 4000) throw new Error('这句话太长了，可以分两句说，或改用文字。');
      this.untranscribed = null;
      stage = 'reply';
      this.patch({ lastHeard: text, phase: 'thinking' });
      const reply = await this.deps.reply(text, pending.signal); if (!valid()) return;
      if (reply) { stage = 'speech'; this.patch({ caption: reply }); await this.say(reply, pending.signal, valid); }
      if (valid()) this.listen(true);
    } catch (e) {
      if (valid()) {
        if (e instanceof CallServiceError && e.requiresReconnect) this.fail(e);
        else this.recoverTurn(stage);
      }
    }
    finally { if (this.pending === pending) this.pending = null; }
  }
  private recoverTurn(stage: 'transcribe' | 'reply' | 'speech') {
    // Retire the failed request and all queued output, not the healthy microphone.
    // A newly started utterance invalidates this path through the turn guard above.
    this.cancelTurn(true); this.clearAudio(); this.listen(true);
    this.turnWarning = stage === 'transcribe'
      ? '刚才这句没转成文字，可以再说一遍。电话还在。'
      : stage === 'reply'
        ? '刚才的回复没接上，你说的话还在，可以继续说。'
        : '这句声音没播完，文字回复还在，可以继续说。';
    this.patch({ inputWarning: this.turnWarning });
  }
  private async say(text: string, signal: AbortSignal, valid: () => boolean) {
    const blob = await this.deps.synthesize(text, signal); if (!valid()) return;
    await this.audio.play(blob, signal, () => { if (valid()) this.patch({ phase: 'speaking' }); });
  }
  private fail(error: unknown) {
    this.cancelTurn(); this.clearAudio(); this.generation++; this.audio.close();
    this.patch({ phase: 'error', level: 0, heardSpeech: false, error: error instanceof Error ? error.message : '这次声音连接没接好，可以重试，或继续打字。' });
  }
  pause = (reason = '') => {
    if (!this.state.active) return;
    this.cancelTurn(); this.clearAudio(); this.generation++; this.audio.close();
    this.patch({ phase: 'paused', level: 0, heardSpeech: false, error: reason });
  };
  resume = async () => {
    if (!this.state.active || !['paused', 'error'].includes(this.state.phase)) return;
    await this.connect();
  };
  hangup = () => {
    if (!this.state.active) return;
    this.cancelTurn(); this.clearAudio(); this.generation++; this.audio.close();
    if (this.clock) clearInterval(this.clock); this.clock = null;
    this.state = idleCall(); this.deps.update(this.state);
  };
  toggleMute = () => {
    if (!this.state.active || ['connecting', 'paused', 'error'].includes(this.state.phase)) return;
    this.patch({ muted: !this.state.muted });
    if (this.state.muted) this.continuation = null;
    if (['listening', 'muted'].includes(this.state.phase)) this.listen();
    else this.monitor();
  };
  private onSpeechStart() {
    if (!this.state.active || this.state.muted) return;
    if (this.state.phase === 'listening') { this.clearIdle(); this.turnWarning = ''; this.patch({ inputWarning: '' }); return; }
    if (!['transcribing', 'thinking', 'speaking'].includes(this.state.phase) && !(this.state.phase === 'connecting' && this.pending)) return;
    const caption = this.state.phase === 'speaking' ? this.state.caption : '';
    // A natural mid-sentence pause can beat ASR. Retain that prefix, but never replay a stale reply.
    if (this.state.phase === 'transcribing' && this.untranscribed) this.continuation = this.untranscribed;
    this.untranscribed = null;
    this.cancelTurn(true); this.patch({ caption }); this.listen(true);
  }
  interrupt = () => {
    if (!this.state.active || (this.state.phase === 'connecting' && !this.pending)) return;
    if (['paused', 'error'].includes(this.state.phase)) { void this.resume(); return; }
    // Explicit "say again" discards an unfinished audio prefix; voice continuation keeps it above.
    this.cancelTurn(); this.clearAudio(); this.patch({ muted: false, caption: '' }); this.listen();
  };
  finish = () => { if (this.state.active && this.state.phase === 'listening' && this.state.heardSpeech) this.audio.finish(); };
}
