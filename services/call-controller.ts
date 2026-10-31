import type { CallState } from '@/domain/types';
import { BrowserCallAudio, type CallAudioPort } from './call-audio';

export const idleCall = (): CallState => ({ active: false, phase: 'idle', muted: false, elapsedSeconds: 0, level: 0, heardSpeech: false, lastHeard: '', caption: '', error: '' });
export interface CallDeps {
  update: (state: CallState) => void;
  transcribe: (file: File, signal: AbortSignal) => Promise<string>;
  reply: (text: string, signal: AbortSignal) => Promise<string | null>;
  synthesize: (text: string, signal: AbortSignal) => Promise<Blob>;
  cancelReply: () => void;
}

/** One call owns one audio session. Every await is invalidated by hangup/pause/interrupt. */
export class CallController {
  private state = idleCall();
  private generation = 0;
  private turn = 0;
  private pending: AbortController | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  constructor(private deps: CallDeps, private audio: CallAudioPort = new BrowserCallAudio()) {}
  get snapshot() { return this.state; }
  private patch(patch: Partial<CallState>) { this.state = { ...this.state, ...patch }; this.deps.update(this.state); }
  private clearIdle() { if (this.idle) clearTimeout(this.idle); this.idle = null; }
  private cancelTurn() { this.turn++; this.pending?.abort(); this.pending = null; this.clearIdle(); this.audio.listen(false); this.audio.stopPlayback(); this.deps.cancelReply(); }
  async start(greeting = '') {
    if (this.state.active) return;
    this.state = idleCall(); this.startedAt = Date.now();
    this.patch({ active: true, phase: 'connecting' });
    this.clock = setInterval(() => { if (this.state.active) this.patch({ elapsedSeconds: Math.floor((Date.now() - this.startedAt) / 1000) }); }, 1000);
    await this.connect(greeting);
  }
  private async connect(greeting = '') {
    const generation = ++this.generation;
    let openingTurn = this.turn;
    const valid = () => this.state.active && generation === this.generation;
    this.patch({ phase: 'connecting', error: '', level: 0, heardSpeech: false });
    try {
      const opened = await this.audio.open({
        meter: (level, heardSpeech) => { if (valid()) this.patch({ level, heardSpeech }); },
        utterance: file => { if (valid() && this.state.phase === 'listening' && !this.state.muted) void this.process(file); },
        failure: message => { if (valid()) this.fail(new Error(message)); },
      });
      if (!opened || !valid()) return;
      if (greeting) {
        const turn = ++this.turn; openingTurn = turn; const pending = new AbortController(); this.pending = pending;
        this.patch({ caption: greeting, phase: 'thinking' });
        await this.say(greeting, pending.signal, () => valid() && turn === this.turn);
        if (!valid() || turn !== this.turn) return;
      }
      this.listen();
    } catch (e) { if (valid() && openingTurn === this.turn) this.fail(e); }
  }
  private listen() {
    if (!this.state.active) return;
    this.clearIdle();
    this.patch({ phase: this.state.muted ? 'muted' : 'listening', level: 0, heardSpeech: false, error: '' });
    this.audio.listen(!this.state.muted);
    if (!this.state.muted) this.idle = setTimeout(() => this.pause('先歇一会儿，麦克风已暂停。想说时再继续。'), 60000);
  }
  private async process(file: File) {
    this.clearIdle(); this.audio.listen(false);
    const generation = this.generation, turn = ++this.turn;
    this.pending?.abort(); const pending = new AbortController(); this.pending = pending;
    const valid = () => this.state.active && this.generation === generation && this.turn === turn && !pending.signal.aborted;
    this.patch({ phase: 'transcribing', level: 0, heardSpeech: false, error: '' });
    try {
      const text = (await this.deps.transcribe(file, pending.signal)).trim(); if (!valid()) return;
      if (!text || text.length > 4000) throw new Error('这句没听清，稍后可以再说一次，或改用文字。');
      this.patch({ lastHeard: text, phase: 'thinking' });
      const reply = await this.deps.reply(text, pending.signal); if (!valid()) return;
      if (reply) { this.patch({ caption: reply }); await this.say(reply, pending.signal, valid); }
      if (valid()) this.listen();
    } catch (e) { if (valid()) this.fail(e); }
    finally { if (this.pending === pending) this.pending = null; }
  }
  private async say(text: string, signal: AbortSignal, valid: () => boolean) {
    const blob = await this.deps.synthesize(text, signal); if (!valid()) return;
    await this.audio.play(blob, signal, () => { if (valid()) this.patch({ phase: 'speaking' }); });
  }
  private fail(error: unknown) {
    this.cancelTurn(); this.generation++; this.audio.close();
    this.patch({ phase: 'error', level: 0, heardSpeech: false, error: error instanceof Error ? error.message : '这次声音连接没接好，可以重试，或继续打字。' });
  }
  pause = (reason = '') => {
    if (!this.state.active) return;
    this.cancelTurn(); this.generation++; this.audio.close();
    this.patch({ phase: 'paused', level: 0, heardSpeech: false, error: reason });
  };
  resume = async () => {
    if (!this.state.active || !['paused', 'error'].includes(this.state.phase)) return;
    await this.connect();
  };
  hangup = () => {
    if (!this.state.active) return;
    this.cancelTurn(); this.generation++; this.audio.close();
    if (this.clock) clearInterval(this.clock); this.clock = null;
    this.state = idleCall(); this.deps.update(this.state);
  };
  toggleMute = () => {
    if (!this.state.active || this.state.phase === 'connecting') return;
    this.patch({ muted: !this.state.muted });
    if (['listening', 'muted'].includes(this.state.phase)) this.listen();
  };
  interrupt = () => {
    if (!this.state.active || this.state.phase === 'connecting') return;
    if (['paused', 'error'].includes(this.state.phase)) { void this.resume(); return; }
    this.cancelTurn(); this.patch({ muted: false }); this.listen();
  };
  finish = () => { if (this.state.active && this.state.phase === 'listening' && this.state.heardSpeech) this.audio.finish(); };
}
