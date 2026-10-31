import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallController, type CallDeps } from '@/services/call-controller';
import { joinCallUtterances, type CallAudioEvents, type CallAudioPort } from '@/services/call-audio';
import { PlaybackEchoGuard, speechLikeFrame } from '@/services/playback-echo';
import { VoiceActivity } from '@/services/voice-activity';
import { encodeWav } from '@/services/media-controller';

const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const wave = (seconds: number, value = .1) => new File([encodeWav(new Float32Array(seconds * 16000).fill(value))], 'call.wav', { type: 'audio/wav' });
const calls: CallController[] = [];
afterEach(() => { calls.splice(0).forEach(c => c.hangup()); });
function setup(overrides: Partial<CallDeps> = {}) {
  let events!: CallAudioEvents;
  const audio = { open: vi.fn(async(e: CallAudioEvents) => { events = e; return true; }), listen: vi.fn(), finish: vi.fn(), close: vi.fn(), stopPlayback: vi.fn(), play: vi.fn(async(_blob: Blob, _signal: AbortSignal, started: () => void) => { started(); }) } satisfies CallAudioPort;
  const deps = { update: vi.fn(), cancelReply: vi.fn(), transcribe: vi.fn(async() => '前一句。'), reply: vi.fn(async() => '接住这一句。'), synthesize: vi.fn(async() => new Blob(['audio'])), ...overrides };
  const call = new CallController(deps, audio); calls.push(call);
  return { call, audio, deps, get events() { return events; } };
}
describe('hands-free interruption', () => {
  it('stops playback as soon as speech starts and keeps the already captured onset', async() => {
    const h = setup(), playing = deferred<void>();
    h.audio.play.mockImplementation(async(_b, _s, start) => { start(); await playing.promise; });
    await h.call.start(); h.events.utterance(wave(1)); await tick(); expect(h.call.snapshot.phase).toBe('speaking');
    h.events.speechStart!();
    expect(h.audio.stopPlayback).toHaveBeenCalledTimes(1); expect(h.audio.listen).toHaveBeenLastCalledWith(true, { preserve: true });
    expect(h.call.snapshot.phase).toBe('listening'); expect(h.call.snapshot.caption).toBe('接住这一句。');
    playing.resolve(); await tick(); expect(h.call.snapshot.phase).toBe('listening');
  });
  it('cancels a pending model without letting its late result enter TTS', async() => {
    const reply = deferred<string>(), h = setup({ reply: vi.fn(() => reply.promise) });
    await h.call.start(); h.events.utterance(wave(1)); await tick(); expect(h.call.snapshot.phase).toBe('thinking');
    h.events.speechStart!(); reply.resolve('旧回答'); await tick();
    expect(h.deps.synthesize).not.toHaveBeenCalled(); expect(h.call.snapshot.phase).toBe('listening'); expect(h.deps.cancelReply).toHaveBeenCalledTimes(1);
  });
  it('can interrupt the greeting and suppress a late synthesis result', async() => {
    const tts = deferred<Blob>(), h = setup({ synthesize: vi.fn(() => tts.promise) });
    const opening = h.call.start('喂，晚上好。'); await tick(); h.events.speechStart!();
    tts.resolve(new Blob(['old'])); await opening;
    expect(h.audio.play).not.toHaveBeenCalled(); expect(h.call.snapshot.phase).toBe('listening');
  });
  it('does not cancel a reply while muted', async() => {
    const reply = deferred<string>(), h = setup({ reply: vi.fn(() => reply.promise) });
    await h.call.start(); h.events.utterance(wave(1)); await tick(); h.call.toggleMute(); h.events.speechStart!();
    expect(h.call.snapshot.phase).toBe('thinking'); expect(h.deps.cancelReply).not.toHaveBeenCalled();
    reply.resolve('这句话仍会说完。'); await tick(); expect(h.call.snapshot.phase).toBe('muted');
  });
  it('joins a resumed sentence to its pending ASR prefix, ignoring the canceled result', async() => {
    const old = deferred<string>(); const transcribe = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue('前半句，后半句。');
    const h = setup({ transcribe }); await h.call.start(); h.events.utterance(wave(1, .1)); await tick();
    const signal = transcribe.mock.calls[0][1] as AbortSignal;
    h.events.speechStart!(); expect(signal.aborted).toBe(true); h.events.utterance(wave(.5, .2)); await tick();
    expect(transcribe).toHaveBeenCalledTimes(2);
    const joined = new DataView(await (transcribe.mock.calls[1][0] as File).arrayBuffer());
    expect(joined.byteLength).toBe(44 + 16000 * 1.6 * 2); expect(joined.getInt16(44, true) / 32768).toBeCloseTo(.1, 3);
    expect(joined.getInt16(44 + 16000 * 1.2 * 2, true) / 32768).toBeCloseTo(.2, 3);
    old.resolve('不完整的前半句'); await tick();
    expect(h.deps.reply).toHaveBeenCalledTimes(1); expect(h.call.snapshot.lastHeard).toBe('前半句，后半句。');
  });
  it('keeps a nascent input when playback finishes before speech confirmation', async() => {
    const h = setup(); await h.call.start(); h.events.utterance(wave(1)); await tick();
    expect(h.audio.listen).toHaveBeenLastCalledWith(true, { preserve: true });
  });
  it('muting discards a carried unfinished sentence before a new utterance', async() => {
    const old = deferred<string>(); const transcribe = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue('新的话。');
    const h = setup({ transcribe }); await h.call.start(); h.events.utterance(wave(1)); await tick();
    h.events.speechStart!(); h.call.toggleMute(); h.call.toggleMute(); h.events.utterance(wave(.5)); await tick();
    expect(transcribe.mock.calls[1][0].size).toBe(44 + 16000); old.resolve('被放弃的句子'); await tick();
    expect(h.call.snapshot.lastHeard).toBe('新的话。');
  });
  it('bounds the joined audio before another paid transcription', async() => {
    await expect(joinCallUtterances(Promise.resolve(wave(54)), wave(2))).rejects.toThrow('这一段有点长');
  });
});
describe('speech onset and echo isolation', () => {
  const tone = (length: number, rate: number, offset = 0) => Float32Array.from({ length }, (_, i) => .06 * Math.sin((i + offset) * 2 * Math.PI * 213 / rate) + .025 * Math.sin((i + offset) * 2 * Math.PI * 573 / rate));
  it('announces speech once, retains consonant pre-roll and finishes in under a second of silence', () => {
    const vad = new VoiceActivity(16000); let starts = 0; let out: Float32Array | null = null;
    for (let i = 0; i < 6; i++) vad.push(new Float32Array(320).fill(.003), false);
    for (let i = 0; i < 20; i++) if (vad.push(tone(320, 16000, i * 320)).speechStarted) starts++;
    for (let i = 0; i < 44; i++) { const r = vad.push(new Float32Array(320)); if (r.utterance) out = r.utterance; }
    expect(starts).toBe(1); expect(out).not.toBeNull(); expect(out![0]).toBeCloseTo(.003); expect(out!.length / 16000).toBeCloseTo(.72, 1);
  });
  it('rejects DC, an isolated click and white hiss as barge-in triggers', () => {
    expect(speechLikeFrame(new Float32Array(1024).fill(.1))).toBe(false);
    const click = new Float32Array(1024); click[500] = .8; expect(speechLikeFrame(click)).toBe(false);
    let seed = 7;
    const hiss = Float32Array.from({ length: 1024 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 4294967296 - .5) * .2; });
    expect(speechLikeFrame(hiss)).toBe(false);
    expect(speechLikeFrame(tone(1024, 48000))).toBe(true);
  });
  it('suppresses delayed playback echo but admits a new speaker over it', () => {
    const guard = new PlaybackEchoGuard(), rate = 48000, pcm = tone(rate, rate);
    guard.attach(pcm, rate, 2); const frameAt = 2.5, delay = .063, at = Math.round((frameAt - 2 - delay) * rate);
    const echo = pcm.slice(at, at + 1024).map(v => v * .6); expect(guard.isEcho(echo, frameAt)).toBe(true);
    const mixed = echo.map((v, i) => v + .06 * Math.sin(i * 2 * Math.PI * 391 / rate)); expect(guard.isEcho(mixed, frameAt)).toBe(false);
    guard.stop(2.5); expect(guard.isEcho(echo, 2.9)).toBe(false);
  });
});
