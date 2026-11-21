import type { CallSpeech } from './speech-stream';
import type { CallState, CallTurnProfile } from '@/domain/types';
import { withAbort } from '@/lib/abort';
import { BrowserCallAudio, joinCallUtterances, type CallAudioPort } from './call-audio';
import { CallServiceError } from './call-error';
import { CALL_TURN_PROFILES } from './voice-activity';

export const CALL_IDLE_MS = 5 * 60000;

export const idleCall = (): CallState => ({ active: false, phase: 'idle', muted: false, elapsedSeconds: 0, level: 0, heardSpeech: false, lastHeard: '', caption: '', error: '' });
export type CallReply = string | { text: string; playback: Promise<void> } | null;
type CallReplyTask = (signal: AbortSignal) => Promise<CallReply>;
type TurnStage = 'transcribe' | 'reply' | 'speech';

export interface CallDeps {
  update: (state: CallState) => void;
  transcribe: (file: File, signal: AbortSignal) => Promise<string>;
  reply: (text: string, signal: AbortSignal) => Promise<CallReply>;
  synthesize: (text: string, signal: AbortSignal) => Promise<CallSpeech>;
  prepareGreeting?: (signal: AbortSignal) => Promise<Blob | null>;
  cancelReply: () => void;
}

/** One call owns one audio session. Every await is invalidated by hangup/pause/interrupt. */
export class CallController {
  private state = idleCall();
  private generation = 0;
  private turn = 0;
  private pending: { aborter: AbortController; cancelOnMute: boolean } | null = null;
  private opening: AbortController | null = null;
  private connection: Promise<boolean> | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;
  private idle: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private lastMeterAt = -Infinity;
  private untranscribed: Promise<File> | null = null;
  private continuation: Promise<File> | null = null;
  private turnWarning = '';
  private profile: CallTurnProfile = 'chat';
  constructor(private deps: CallDeps, private audio: CallAudioPort = new BrowserCallAudio()) {}
  get snapshot() { return this.state; }
  setProfile(profile: CallTurnProfile) {
    if (profile === this.profile) return;
    this.profile = profile;
    this.audio.setProfile?.(profile);
  }
  observeNetworkDelay = (ms: number) => { if (this.state.active) this.audio.observeNetworkDelay?.(ms); };
  private patch(patch: Partial<CallState>) { this.state = { ...this.state, ...patch }; this.deps.update(this.state); }
  private clearIdle() { if (this.idle) clearTimeout(this.idle); this.idle = null; }
  private cancelTurn(preserveCapture = false) {
    this.turn++;
    this.pending?.aborter.abort(); this.pending = null;
    if (!this.connection) this.opening?.abort();
    this.clearIdle();
    if (!preserveCapture) this.audio.listen(false);
    this.audio.stopPlayback();
    if (this.state.captionPreview) this.patch({ caption: '', captionPreview: false });
    this.deps.cancelReply();
  }
  private beginTurn(cancelOnMute = false) {
    const generation = this.generation, turn = ++this.turn;
    this.pending?.aborter.abort();
    const pending = { aborter: new AbortController(), cancelOnMute }; this.pending = pending;
    const { signal } = pending.aborter;
    const valid = () => this.state.active && this.generation === generation && this.turn === turn && !signal.aborted;
    return { pending, signal, valid };
  }
  private ownsTurn(signal: AbortSignal) { return this.pending?.aborter.signal === signal && !signal.aborted; }
  cancelTurnOnMute(signal: AbortSignal) {
    if (this.pending?.aborter.signal === signal && !signal.aborted) this.pending.cancelOnMute = true;
  }
  private monitor() { this.audio.listen(!this.state.muted, { interruptible: true }); }
  private clearAudio() { this.untranscribed = this.continuation = null; }
  async start(greeting = '', firstReply?: CallReplyTask) {
    if (this.state.active) return;
    this.state = idleCall(); this.clearAudio(); this.startedAt = Date.now();
    this.patch({ active: true, phase: 'connecting' });
    if (!this.state.active) return;
    this.clock = setInterval(() => { if (this.state.active) this.patch({ elapsedSeconds: Math.floor((Date.now() - this.startedAt) / 1000) }); }, 1000);
    const connecting = this.connect(greeting);
    if (firstReply) await this.triggerTurn(firstReply);
    await connecting;
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
      const connection = withAbort(this.audio.open({
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
      }), opening.signal);
      this.connection = connection;
      const opened = await connection;
      if (!valid()) return;
      if (!opened) throw new Error('还没能打开麦克风，可以重试或继续打字。');
      this.connection = null;
      // Finish local ringback before enabling capture; it must not masquerade as user speech.
      this.audio.stopDialTone?.();
      if (openingTurn !== this.turn) {
        if (!this.pending) this.listen(true);
        return;
      }
      if (greeting) {
        const turn = this.beginTurn(); openingTurn = this.turn;
        this.patch({ caption: greeting, phase: 'connecting' });
        this.monitor();
        try {
          const cached = await withAbort(prepared, turn.signal);
          if (!turn.valid()) return;
          if (cached) await this.play(cached, turn.signal, turn.valid);
          else await this.say(greeting, turn.signal, turn.valid);
          if (!turn.valid()) return;
        } finally { if (this.pending === turn.pending) this.pending = null; }
      }
      this.listen(true);
    } catch (e) { if (valid() && (this.connection || openingTurn === this.turn)) this.fail(e); }
    finally {
      opening.abort();
      if (this.opening === opening) { this.opening = null; this.connection = null; }
    }
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
  private process(file: File) { return this.runTurn(this.deps.reply, file); }
  async triggerTurn(reply: CallReplyTask) {
    if (!this.state.active || ['paused', 'error'].includes(this.state.phase)) return;
    if (this.pending) this.cancelTurn(true);
    this.clearAudio();
    await this.runTurn((_, signal) => reply(signal));
  }
  cancelPendingTurn() {
    if (!this.state.active) return;
    this.cancelTurn(true); this.clearAudio();
    if (!this.connection && !['paused', 'error'].includes(this.state.phase)) this.listen(true);
  }
  previewTurn(signal: AbortSignal, caption: string) {
    if (this.ownsTurn(signal) && ['thinking', 'speaking'].includes(this.state.phase)) this.patch({ caption, captionPreview: true });
  }
  async playTurnSpeech(signal: AbortSignal, stream: { audio: Promise<CallSpeech>; audioDone: Promise<void>; earlyAudio: boolean }) {
    if (!this.ownsTurn(signal)) return;
    this.cancelTurnOnMute(signal);
    const playback = new AbortController(), playSignal = AbortSignal.any([signal, playback.signal]);
    const valid = () => this.ownsTurn(signal) && !playSignal.aborted;
    let playing = false;
    const start = async () => {
      const speech = await withAbort(stream.audio, playSignal);
      if (!valid()) return;
      playing = true;
      await this.play(speech, playSignal, valid, stream.earlyAudio);
    };
    try { await Promise.all([start(), withAbort(stream.audioDone, playSignal)]); }
    catch (error) {
      playback.abort(error);
      if (this.ownsTurn(signal)) {
        if (playing) this.audio.stopPlayback();
        if (this.state.captionPreview || this.state.phase === 'speaking') {
          this.patch({ phase: 'thinking', ...(this.state.captionPreview ? { caption: '', captionPreview: false } : {}) });
        }
      }
      throw error;
    }
  }
  private async runTurn(reply: CallDeps['reply'], file?: File) {
    this.clearIdle();
    this.turnWarning = '';
    let stage: TurnStage = file ? 'transcribe' : 'reply';
    const { pending, signal, valid } = this.beginTurn(!file);
    const connection = this.connection;
    try {
      if (connection && !(await withAbort(connection, signal))) return;
      if (!valid()) return;
      const audio = file ? (this.continuation ? joinCallUtterances(this.continuation, file, CALL_TURN_PROFILES[this.profile].maxSeconds) : Promise.resolve(file)) : null;
      this.continuation = null; this.untranscribed = audio;
      this.patch({ phase: file ? 'transcribing' : 'thinking', level: 0, heardSpeech: false, error: '', inputWarning: '' });
      this.monitor();
      let text = '';
      if (audio) {
        const utterance = await audio; if (!valid()) return;
        text = (await withAbort(this.deps.transcribe(utterance, signal), signal)).trim(); if (!valid()) return;
        this.untranscribed = null;
        if (!text) { this.listen(); this.patch({ inputWarning: '这句没听清，可以再说一次。' }); return; }
        if (text.length > 4000) throw new Error('这句话太长了，可以分两句说，或改用文字。');
        stage = 'reply';
        this.patch({ lastHeard: text, phase: 'thinking' });
      }
      if (!valid()) return;
      const result = await withAbort(reply(text, signal), signal); if (!valid()) return;
      if (result) {
        stage = 'speech';
        const caption = typeof result === 'string' ? result : result.text;
        this.patch({ caption, captionPreview: false });
        if (typeof result === 'string') await this.say(result, signal, valid);
        else await result.playback;
      }
      if (valid()) {
        this.listen(true);
        if (!result) pending.aborter.abort();
      }
    } catch (e) {
      if (valid()) {
        if (e instanceof CallServiceError && e.requiresReconnect) this.fail(e);
        else this.recoverTurn(stage);
      }
    }
    finally { if (this.pending === pending) this.pending = null; }
  }
  private recoverTurn(stage: TurnStage) {
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
    if (!valid()) return;
    const blob = await this.deps.synthesize(text, signal); if (!valid()) return;
    await this.play(blob, signal, valid);
  }
  private play(speech: CallSpeech, signal: AbortSignal, valid: () => boolean, startWithFirstChunk?: boolean) {
    const onStart = () => { if (valid()) this.patch({ phase: 'speaking' }); };
    const playback = startWithFirstChunk ? this.audio.play(speech, signal, onStart, true) : this.audio.play(speech, signal, onStart);
    return withAbort(playback, signal);
  }
  private closeAudio() {
    this.generation++; this.connection = null;
    this.opening?.abort(); this.opening = null;
    this.audio.close();
  }
  private fail(error: unknown) {
    this.cancelTurn(); this.clearAudio(); this.closeAudio();
    this.patch({ phase: 'error', level: 0, heardSpeech: false, error: error instanceof Error ? error.message : '这次声音连接没接好，可以重试，或继续打字。' });
  }
  pause = (reason = '') => {
    if (!this.state.active) return;
    this.cancelTurn(); this.clearAudio(); this.closeAudio();
    this.patch({ phase: 'paused', level: 0, heardSpeech: false, error: reason });
  };
  resume = async () => {
    if (!this.state.active || !['paused', 'error'].includes(this.state.phase)) return;
    await this.connect();
  };
  hangup = () => {
    if (!this.state.active) return;
    this.cancelTurn(); this.clearAudio(); this.closeAudio();
    if (this.clock) clearInterval(this.clock); this.clock = null;
    this.state = idleCall(); this.deps.update(this.state);
  };
  toggleMute = () => {
    if (!this.state.active || ['paused', 'error'].includes(this.state.phase) || (this.state.phase === 'connecting' && !this.pending?.cancelOnMute)) return;
    this.patch({ muted: !this.state.muted });
    if (this.state.muted) this.continuation = null;
    if (this.state.muted && this.pending?.cancelOnMute) this.cancelPendingTurn();
    else if (['listening', 'muted'].includes(this.state.phase)) this.listen();
    else this.monitor();
  };
  private onSpeechStart() {
    if (!this.state.active || this.state.muted) return;
    if (this.state.phase === 'listening') { this.clearIdle(); this.turnWarning = ''; this.patch({ inputWarning: '' }); return; }
    if (!['transcribing', 'thinking', 'speaking'].includes(this.state.phase) && !(this.state.phase === 'connecting' && this.pending)) return;
    const caption = this.state.phase === 'speaking' && !this.state.captionPreview ? this.state.caption : '';
    // A natural mid-sentence pause can beat ASR. Retain that prefix, but never replay a stale reply.
    if (this.state.phase === 'transcribing' && this.untranscribed) this.continuation = this.untranscribed;
    this.untranscribed = null;
    this.cancelTurn(true); this.patch({ caption }); this.listen(true);
  }
  interrupt = () => {
    if (!this.state.active || this.connection) return;
    if (['paused', 'error'].includes(this.state.phase)) { void this.resume(); return; }
    // Explicit "say again" discards an unfinished audio prefix; voice continuation keeps it above.
    this.cancelTurn(); this.clearAudio(); this.patch({ muted: false, caption: '' }); this.listen();
  };
  finish = () => { if (this.state.active && this.state.phase === 'listening' && this.state.heardSpeech) this.audio.finish(); };
}
