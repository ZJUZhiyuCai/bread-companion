import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/agent/voice/route';
import { POST as textTurn } from '@/app/api/agent/turn/route';
import * as generation from '@/server/agent-turn';
import * as speech from '@/server/providers/speech';
import { resetLimitsForTest, acquireBudget } from '@/server/limits';
import { resetCircuitsForTest } from '@/server/resilience';
import { AppError } from '@/server/errors';
import { requestFixture } from '@/fixtures/scenarios';
import { mockCandidate } from '@/server/providers/mock-agent';
import { requestVoiceTurn } from '@/services/voice-turn';
import { getCapabilities } from '@/server/config';
import { BreadController } from '@/services/bread-controller';
import type { CallAudioEvents, CallAudioPort } from '@/services/call-audio';
import type { TurnRequest } from '@/domain/types';
import { responseStyleErrors } from '@/domain/response-style';

const deferred = <T,>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const input = () => requestFixture({ mode: 'listen', channel: 'call' });
const request = (body = input(), signal?: AbortSignal) => new Request('http://localhost:3210/api/agent/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
const encoded = (event: unknown) => new TextEncoder().encode(JSON.stringify(event) + '\n');
const successEvents = () => [
  { type: 'candidate', candidate: mockCandidate(input()) },
  { type: 'audio', requestId: input().requestId, mime: 'audio/mpeg', audio: 'SUQzAA==' },
  { type: 'done', requestId: input().requestId },
];
const response = (events: unknown[], close = true) => new Response(new ReadableStream({ start(c) { events.forEach(e => c.enqueue(encoded(e))); if (close) c.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });

beforeEach(() => {
  resetLimitsForTest(); resetCircuitsForTest();
  vi.stubEnv('BREAD_PUBLIC_ORIGIN', ''); vi.stubEnv('AGENT_PROVIDER', 'mock');
  vi.stubEnv('TTS_PROVIDER', 'minimax'); vi.stubEnv('MINIMAX_API_KEY', 'fixture-only');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('checked reply and speech share one request', () => {
  it('emits the checked text while synthesis is still pending, then sends audio exactly once', async () => {
    const clip = deferred<Uint8Array>();
    const generate = vi.spyOn(generation, 'generateTurn').mockResolvedValue({ candidate: mockCandidate(input()), providerMs: 35 });
    const synth = vi.spyOn(speech, 'synthesize').mockImplementation(() => clip.promise);
    const res = await POST(request()); const reader = res.body!.getReader();
    const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    expect(first.type).toBe('candidate'); expect(first.candidate.requestId).toBe(input().requestId);
    await vi.waitFor(() => expect(synth).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledTimes(1);
    clip.resolve(new Uint8Array([73, 68, 51, 0]));
    let rest = ''; for (;;) { const r = await reader.read(); if (r.done) break; rest += new TextDecoder().decode(r.value); }
    const events = rest.trim().split('\n').map(s => JSON.parse(s));
    expect(events.map(e => e.type)).toEqual(['audio', 'done']);
    expect(events[0].audio).toBe('SUQzAA==');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('never starts paid speech for a rejected candidate, and does not fall back to another generation', async () => {
    const generate = vi.spyOn(generation, 'generateTurn').mockRejectedValue(new AppError('INVALID_MODEL_OUTPUT', 502, true));
    const synth = vi.spyOn(speech, 'synthesize');
    const res = await POST(request()); const events = (await res.text()).trim().split('\n').map(s => JSON.parse(s));
    expect(events.map(e => e.type)).toEqual(['error']); expect(synth).not.toHaveBeenCalled(); expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retains separate deduplication across voice and ordinary agent routes', async () => {
    vi.spyOn(generation, 'generateTurn').mockResolvedValue({ candidate: mockCandidate(input()), providerMs: 1 });
    vi.spyOn(speech, 'synthesize').mockResolvedValue(new Uint8Array([1, 2]));
    await (await POST(request())).text();
    expect((await POST(request())).status).toBe(409);
    expect((await textTurn(request({ ...input(), channel: 'text' }))).status).toBe(409);
  });

  it('aborts speech and frees both capability slots when the browser cancels the body', async () => {
    vi.spyOn(generation, 'generateTurn').mockResolvedValue({ candidate: mockCandidate(input()), providerMs: 1 });
    let signal!: AbortSignal;
    vi.spyOn(speech, 'synthesize').mockImplementation((_text, s) => { signal = s; return new Promise(() => {}); });
    const res = await POST(request()); const reader = res.body!.getReader(); await reader.read();
    await vi.waitFor(() => expect(signal).toBeDefined());
    await reader.cancel(); expect(signal.aborted).toBe(true);
    await vi.waitFor(() => {
      for (const lane of ['call', 'tts']) {
        const releases: (() => void)[] = [];
        try { for (let n = 0; n < 3; n++) releases.push(acquireBudget(lane)); }
        finally { releases.forEach(release => release()); }
      }
    });
  });

  it('does not start synthesis after canceling a model that ignores abort', async () => {
    const late = deferred<Awaited<ReturnType<typeof generation.generateTurn>>>();
    vi.spyOn(generation, 'generateTurn').mockImplementation(() => late.promise);
    const synth = vi.spyOn(speech, 'synthesize');
    const abort = new AbortController(), res = await POST(request(input(), abort.signal));
    abort.abort(); late.resolve({ candidate: mockCandidate(input()), providerMs: 1 });
    expect(await res.text()).toBe(''); expect(synth).not.toHaveBeenCalled();
  });

  it('keeps a valid reply when TTS fails, with no hidden retry or audio event', async () => {
    vi.spyOn(generation, 'generateTurn').mockResolvedValue({ candidate: mockCandidate(input()), providerMs: 1 });
    const synth = vi.spyOn(speech, 'synthesize').mockRejectedValue(new AppError('PROVIDER_UNAVAILABLE', 502, true));
    const events = (await (await POST(request())).text()).trim().split('\n').map(s => JSON.parse(s));
    expect(events.map(e => e.type)).toEqual(['candidate', 'error']); expect(synth).toHaveBeenCalledTimes(1);
  });

  it('rejects other modes, unconfigured speech and cross-site requests before generating', async () => {
    const generate = vi.spyOn(generation, 'generateTurn');
    expect((await POST(request({ ...input(), mode: 'review' }))).status).toBe(400);
    const cross = request(); cross.headers.set('Origin', 'https://attacker.example');
    expect((await POST(cross)).status).toBe(403);
    vi.stubEnv('TTS_PROVIDER', 'disabled'); expect((await POST(request())).status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('bounded browser voice transport', () => {
  it('makes the candidate available before audio and accepts fragmented UTF-8 events', async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(c) { writer = c; } });
    const fetcher = vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }));
    const turn = requestVoiceTurn(fetcher, input(), new AbortController().signal);
    const events = successEvents(), bytes = encoded(events[0]);
    for (const byte of bytes) writer.enqueue(new Uint8Array([byte]));
    expect((await turn.candidate).assistantText).toBe(mockCandidate(input()).assistantText);
    let resolved = false; void turn.audio.then(() => { resolved = true; });
    await Promise.resolve(); expect(resolved).toBe(false);
    writer.enqueue(encoded(events[1])); writer.enqueue(encoded(events[2])); writer.close();
    expect(new Uint8Array(await (await turn.audio).arrayBuffer())).toEqual(new Uint8Array([73, 68, 51, 0]));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects wrong versions, out-of-order audio and a missing completion marker', async () => {
    const events = successEvents();
    for (const broken of [
      [{ ...events[0], candidate: { ...mockCandidate(input()), epoch: 99 } }],
      [events[1]],
      events.slice(0, 2),
      [events[0], { ...events[1], requestId: 'wrong' }],
    ]) {
      const turn = requestVoiceTurn(vi.fn(async () => response(broken)), input(), new AbortController().signal);
      await expect(turn.audio).rejects.toThrow();
    }
  });

  it('a stalled body is canceled on the deadline, even after the text arrived', async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoded(successEvents()[0])); }, cancel });
    const turn = requestVoiceTurn(vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } })), input(), new AbortController().signal, 100);
    await turn.candidate; await vi.advanceTimersByTimeAsync(101);
    await expect(turn.audio).rejects.toMatchObject({ name: 'TimeoutError' }); expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('hangup settles even if fetch never resolves and does not retry', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {})); const abort = new AbortController();
    const turn = requestVoiceTurn(fetcher, input(), abort.signal); abort.abort();
    await expect(turn.candidate).rejects.toMatchObject({ name: 'AbortError' }); await expect(turn.audio).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('supports an explicit server rollout switch while old clients keep using the original API', () => {
    vi.stubEnv('AGENT_PROVIDER', 'real'); expect(getCapabilities().tts.turnStream).toBe(true);
    vi.stubEnv('BREAD_COMBINED_VOICE', 'off'); expect(getCapabilities().tts.turnStream).toBeUndefined();
  });
});

describe('call controller owns the combined response', () => {
  async function callHarness() {
    let events!: CallAudioEvents, writer!: ReadableStreamDefaultController<Uint8Array>, sent!: TurnRequest;
    const audio: CallAudioPort = { open: vi.fn(async e => { events = e; return true; }), close: vi.fn(), listen: vi.fn(), finish: vi.fn(), stopPlayback: vi.fn(), play: vi.fn(async (_b, _s, start) => { start(); }) };
    const canceled = vi.fn();
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/capabilities')) {
        const caps = getCapabilities(); caps.agent.configured = true; caps.asr.available = true; caps.tts.turnStream = true;
        return Response.json(caps);
      }
      if (String(url).endsWith('/transcribe')) return Response.json({ requestId: (init!.body as FormData).get('requestId'), text: '今天不想听建议。' });
      if (String(url).endsWith('/voice')) {
        sent = JSON.parse(init!.body as string);
        return new Response(new ReadableStream<Uint8Array>({ start(c) { writer = c; }, cancel: canceled }), { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      throw new Error('Unexpected separate request: ' + url);
    });
    const c = new BreadController(fetcher, undefined, audio); await c.initialize(); await c.startCall();
    vi.mocked(audio.play).mockClear();
    events.utterance(new File(['fixture'], 'speech.wav', { type: 'audio/wav' }));
    await vi.waitFor(() => expect(sent).toBeDefined());
    const reply = mockCandidate(sent);
    writer.enqueue(encoded({ type: 'candidate', candidate: reply }));
    await vi.waitFor(() => expect(c.getSnapshot().state.messages.at(-1)?.role).toBe('assistant'));
    return { c, audio, fetcher, canceled, reply, events, complete() { writer.enqueue(encoded({ type: 'audio', requestId: sent.requestId, mime: 'audio/mpeg', audio: 'SUQzAA==' })); writer.enqueue(encoded({ type: 'done', requestId: sent.requestId })); writer.close(); }, fail() { writer.enqueue(encoded({ type: 'error', error: { requestId: sent.requestId, userMessage: '声音暂时没接上。' } })); writer.close(); } };
  }

  it('shows checked text before speech is ready and never sends an extra TTS request', async () => {
    const h = await callHarness();
    try {
      expect(h.audio.play).not.toHaveBeenCalled(); expect(h.c.getSnapshot().call.phase).toBe('thinking');
      h.complete(); await vi.waitFor(() => expect(h.audio.play).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(h.c.getSnapshot().call.phase).toBe('listening'));
      expect(h.fetcher.mock.calls.some(([url]) => String(url).endsWith('/synthesize'))).toBe(false);
    } finally { h.c.dispose(); }
  });

  it('natural interruption cancels the pending audio without removing the completed text', async () => {
    const h = await callHarness();
    try {
      h.events.speechStart!(); await vi.waitFor(() => expect(h.canceled).toHaveBeenCalledTimes(1));
      expect(h.audio.play).not.toHaveBeenCalled(); expect(h.c.getSnapshot().call.phase).toBe('listening');
      expect(h.c.getSnapshot().state.messages.at(-1)?.text).toBe(h.reply.assistantText);
    } finally { h.c.dispose(); }
  });

  it('a speech failure keeps the reply, releases the microphone and waits for explicit reconnect', async () => {
    const h = await callHarness();
    try {
      h.fail(); await vi.waitFor(() => expect(h.c.getSnapshot().call.phase).toBe('error'));
      expect(h.c.getSnapshot().state.messages.at(-1)?.text).toBe(h.reply.assistantText);
      expect(h.audio.close).toHaveBeenCalled(); expect(h.audio.play).not.toHaveBeenCalled();
      expect(h.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/voice'))).toHaveLength(1);
    } finally { h.c.dispose(); }
  });

  it('rejects another measured blaming opener without blocking a negation later in the reply', () => {
    expect(responseStyleErrors('又出了点问题，今天这场面试本来挺看重的吧。', input())).toContain('STYLE_NO_BLAMING_OPENER');
    expect(responseStyleErrors('不是说你又出了问题，我刚才理解错了。', input())).toEqual([]);
  });
});
