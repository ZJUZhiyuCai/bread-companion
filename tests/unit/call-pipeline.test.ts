import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCallSeed, completeCallSeed, callSource, callSeedSchema, type CallSeed } from '@/domain/call-pipeline';
import { initialState, reducer, uid } from '@/domain/reducer';
import { turnRequestSchema } from '@/domain/schemas';
import { conversationPreferences } from '@/domain/preferences';
import { buildTurn } from '@/domain/context-builder';
import { requestAudioTurn, VoiceTransportUnavailable } from '@/services/voice-turn';
import { BreadController } from '@/services/bread-controller';
import { getCapabilities } from '@/server/config';
import type { CallAudioEvents, CallAudioPort } from '@/services/call-audio';
import { POST } from '@/app/api/agent/voice/route';
import { POST as transcribeOnly } from '@/app/api/speech/transcribe/route';
import * as generation from '@/server/agent-turn';
import * as speech from '@/server/providers/speech';
import { bufferSpeechStart } from '@/server/providers/speech-buffer';
import { mockCandidate } from '@/server/providers/mock-agent';
import { resetLimitsForTest } from '@/server/limits';
import { resetCircuitsForTest } from '@/server/resilience';
import { AppError } from '@/server/errors';
import { encodeWav } from '@/services/media-controller';

const fresh = () => reducer(initialState(), { type: 'START', mode: 'listen' });
const file = () => new File([encodeWav(new Float32Array(16000))], 'voice.wav', { type: 'audio/wav' });
const encoded = (e: unknown) => new TextEncoder().encode(JSON.stringify(e) + '\n');
function envelope(seed: CallSeed, signal?: AbortSignal) {
  const body = new FormData(); body.set('seed', JSON.stringify(seed)); body.set('file', file());
  return new Request('http://localhost:3210/api/agent/voice', { method: 'POST', body, signal });
}
const controllers: BreadController[] = [];
beforeEach(() => {
  resetLimitsForTest(); resetCircuitsForTest();
  vi.stubEnv('BREAD_PUBLIC_ORIGIN', ''); vi.stubEnv('AGENT_PROVIDER', 'mock');
  vi.stubEnv('ASR_PROVIDER', 'minimax'); vi.stubEnv('TTS_PROVIDER', 'minimax'); vi.stubEnv('MINIMAX_API_KEY', 'fixture-only');
});
afterEach(() => { controllers.splice(0).forEach(c => c.dispose()); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('single-request call context retains the existing harness', () => {
  it('reconstructs the exact normal request over a long conversation, retaining old preferences and current overrides', () => {
    let state = fresh();
    const texts = ['今晚不想听建议，也不要问我。', ...Array.from({ length: 35 }, (_, n) => `第${n}次回答，${'一些准备过的内容。'.repeat(n % 4)}`), '现在可以问我。'];
    for (const text of texts) {
      const seed = createCallSeed(state)!; expect(seed).not.toBeNull();
      expect(seed.messages.length).toBeLessThanOrEqual(28); expect(seed.sources.length).toBeLessThanOrEqual(12);
      state = reducer(state, { type: 'USER', text, source: callSource(text, seed.sourceId) });
      const expected = { ...buildTurn(state, text, seed.runId, seed.requestId), channel: 'call' };
      expect(completeCallSeed(seed, text)).toEqual(expected);
      expect(JSON.stringify(completeCallSeed(seed, text))).toBe(JSON.stringify(turnRequestSchema.parse(expected)));
      state = { ...state, messages: [...state.messages, { id: uid('message'), role: 'assistant', text: `听到了第${state.contextRevision}句话。` }] };
    }
    const result = completeCallSeed(createCallSeed(state)!, '我还是有些失落。')!;
    expect(result.context.preferences).toEqual({ advice: 'on_request', questions: 'allowed' });
  });
  it.each(['', '停止', '结束', '挂断电话', '帮我复盘一下', '陪我练一题'])('leaves the control instruction %s with the client without generating', text => {
    expect(completeCallSeed(createCallSeed(fresh())!, text)).toBeNull();
  });
  it('recognizes direct time-qualified preferences without converting quotations or other people into preferences', () => {
    expect(conversationPreferences([{ role: 'user', text: '今晚不想听建议，今天也不要追问。' }])).toEqual({ advice: 'on_request', questions: 'avoid' });
    expect(conversationPreferences([{ role: 'user', text: '她说“今晚不想听建议”，朋友今天不要追问。' }])).toEqual({});
  });
  it('keeps evidence workflows, corrected material and oversized snapshots on the original path', () => {
    const state = fresh();
    expect(createCallSeed({ ...state, mode: 'review' })).toBeNull();
    expect(createCallSeed({ ...state, sources: [callSource('单独粘贴的材料')] })).toBeNull();
    const text = '旧材料'; const source = callSource(text);
    const changed = reducer(state, { type: 'USER', text, source });
    expect(createCallSeed({ ...changed, sources: [{ ...source, text: '修正材料', revision: 2 }] })).toBeNull();
    let large = state; for (let i = 0; i < 12; i++) { const text = '长'.repeat(4000); large = reducer(large, { type: 'USER', text, source: callSource(text) }); }
    expect(createCallSeed(large)).toBeNull();
    const seed = createCallSeed(state)!;
    expect(callSeedSchema.safeParse({ ...seed, unexpected: true }).success).toBe(false);
  });
});

describe('ASR, checked reply and speech over one response', () => {
  function providers(text = '准备了很久还是被拒绝，今晚不想听建议。') {
    const asr = vi.spyOn(speech, 'transcribe').mockResolvedValue(text);
    const agent = vi.spyOn(generation, 'generateTurn').mockImplementation(async input => ({ candidate: mockCandidate(input), providerMs: 1 }));
    const tts = vi.spyOn(speech, 'synthesize').mockResolvedValue(new Uint8Array([73, 68, 51, 0]));
    return { asr, agent, tts };
  }
  it('preserves the transcript, preference, checked metadata and three separate accounting lanes', async () => {
    const p = providers(), seed = createCallSeed(fresh())!;
    const events = (await (await POST(envelope(seed))).text()).trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(e => e.type)).toEqual(['transcript', 'candidate', 'audio', 'done']);
    expect(events[1].candidate.contextRevision).toBe(seed.contextRevision + 1);
    expect(p.agent.mock.calls[0][0].context.preferences?.advice).toBe('on_request');
    expect(p.asr).toHaveBeenCalledTimes(1); expect(p.agent).toHaveBeenCalledTimes(1); expect(p.tts).toHaveBeenCalledTimes(1);
    expect((await POST(envelope(seed))).status).toBe(409);
    const f = new FormData(); f.set('file', file()); f.set('requestId', seed.requestId);
    expect((await transcribeOnly(new Request('http://localhost:3210/api/speech/transcribe', { method: 'POST', body: f }))).status).toBe(409);
  });
  it.each(['', '停止', '帮我复盘一下', '晚安'])('does not bill a model or voice for transcript-only %s', async text => {
    const p = providers(text), seed = createCallSeed(fresh())!;
    const events = (await (await POST(envelope(seed))).text()).trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(e => e.type)).toEqual(['transcript', 'transcript_done']);
    expect(p.agent).not.toHaveBeenCalled(); expect(p.tts).not.toHaveBeenCalled();
  });
  it('does not generate or synthesize after aborted ASR, even if the adapter resolves late', async () => {
    const p = providers(); let resolve!: (text: string) => void;
    p.asr.mockImplementation(() => new Promise(r => { resolve = r; }));
    const abort = new AbortController(); const res = await POST(envelope(createCallSeed(fresh())!, abort.signal));
    await vi.waitFor(() => expect(resolve).toBeDefined()); abort.abort(); resolve('迟到的文字');
    expect(await res.text()).toBe(''); expect(p.agent).not.toHaveBeenCalled(); expect(p.tts).not.toHaveBeenCalled();
  });
  it('does not conceal an ASR failure, retry the whole pipeline, or speak a rejected candidate', async () => {
    const p = providers(); p.asr.mockRejectedValueOnce(new AppError('PROVIDER_UNAVAILABLE', 502));
    const first = await (await POST(envelope(createCallSeed(fresh())!))).text();
    expect(JSON.parse(first).error.stage).toBe('transcribe'); expect(p.agent).not.toHaveBeenCalled();
    p.agent.mockRejectedValueOnce(new AppError('INVALID_MODEL_OUTPUT', 502));
    const second = (await (await POST(envelope(createCallSeed(fresh())!))).text()).trim().split('\n').map(s => JSON.parse(s));
    expect(second.map(e => e.type)).toEqual(['transcript', 'error']); expect(p.tts).not.toHaveBeenCalled();
  });
  it('rejects malformed snapshots and cross-origin requests before ASR', async () => {
    const p = providers(), req = envelope(createCallSeed(fresh())!); req.headers.set('Origin', 'https://invalid.example');
    expect((await POST(req)).status).toBe(403);
    const form = new FormData(); form.set('file', file()); form.set('seed', '{"private":"invalid"}');
    expect((await POST(new Request('http://localhost:3210/api/agent/voice', { method: 'POST', body: form }))).status).toBe(400);
    expect(p.asr).not.toHaveBeenCalled();
  });
});

describe('bounded media transport and controller ownership', () => {
  it('handles transcript-only responses and rejects a candidate arriving before its transcript', async () => {
    const seed = createCallSeed(fresh())!;
    const response = (events: unknown[]) => new Response(events.map(e => JSON.stringify(e)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
    const turn = requestAudioTurn(async () => response([{ type: 'transcript', requestId: seed.requestId, text: '停止' }, { type: 'transcript_done', requestId: seed.requestId }]), seed, file(), new AbortController().signal);
    expect(await turn.transcript).toBe('停止'); await expect(turn.audio).rejects.toThrow();
    const wrong = requestAudioTurn(async () => response([{ type: 'candidate', candidate: mockCandidate(completeCallSeed(seed, '这句迟到了')!) }]), seed, file(), new AbortController().signal);
    await expect(wrong.transcript).rejects.toThrow(); await expect(wrong.candidate).rejects.toThrow();
  });
  it.each([415, 502])('only treats a known pre-billing media rejection as fallback (%i)', async status => {
    const turn = requestAudioTurn(async () => new Response('unsupported', { status }), createCallSeed(fresh())!, file(), new AbortController().signal);
    if (status === 415) await expect(turn.transcript).rejects.toBeInstanceOf(VoiceTransportUnavailable);
    else await expect(turn.transcript).rejects.not.toBeInstanceOf(VoiceTransportUnavailable);
  });
  it('runs successive calls with one POST each and no duplicate user message, model or synthesis', async () => {
    let events!: CallAudioEvents;
    const audio: CallAudioPort = { open: vi.fn(async e => { events = e; return true; }), close: vi.fn(), listen: vi.fn(), finish: vi.fn(), stopPlayback: vi.fn(), play: vi.fn(async (_b, _s, start) => start()) };
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/capabilities')) { const caps = getCapabilities(); caps.agent.configured = true; caps.asr.callPipeline = true; caps.asr.opusUpload = false; caps.tts.turnStream = true; return Response.json(caps); }
      if (!String(url).endsWith('/voice') || !(init?.body instanceof FormData)) throw Error('Unexpected separate request');
      const seed = callSeedSchema.parse(JSON.parse(String(init.body.get('seed')))), text = '准备了很久，今晚不想听建议。';
      const candidate = mockCandidate(completeCallSeed(seed, text)!);
      return new Response(new ReadableStream({ start(c) { [{ type: 'transcript', requestId: seed.requestId, text }, { type: 'candidate', candidate }, { type: 'audio', requestId: seed.requestId, mime: 'audio/mpeg', audio: 'SUQzAA==' }, { type: 'done', requestId: seed.requestId }].forEach(e => c.enqueue(encoded(e))); c.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
    });
    const controller = new BreadController(fetcher, undefined, audio); controllers.push(controller); await controller.initialize(); await controller.startCall(); vi.mocked(audio.play).mockClear();
    for (let n = 1; n <= 3; n++) { events.utterance(file()); await vi.waitFor(() => expect(audio.play).toHaveBeenCalledTimes(n)); expect(controller.getSnapshot().call.phase).toBe('listening'); }
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/voice'))).toHaveLength(3);
    expect(controller.getSnapshot().state.messages.filter(m => m.role === 'user')).toHaveLength(3);
  });
});

describe('startup speech packet', () => {
  it('joins the initial fragments byte-for-byte, preserves the tail and flushes a short response at EOF', async () => {
    const parts = [new Uint8Array(4500).fill(1), new Uint8Array(12000).fill(2), new Uint8Array(20000).fill(3)];
    async function* source() { yield* parts; }
    const out: Uint8Array[] = []; for await (const chunk of bufferSpeechStart(source())) out.push(chunk);
    expect(out.map(c => c.length)).toEqual([16500, 20000]);
    expect(Buffer.concat(out)).toEqual(Buffer.concat(parts));
    async function* short() { yield parts[0]; }
    const tiny: Uint8Array[] = []; for await (const chunk of bufferSpeechStart(short())) tiny.push(chunk);
    expect(tiny).toEqual([parts[0]]);
  });
  it('does not flush a failed partial burst as if it were a complete short reply', async () => {
    async function* source() { yield new Uint8Array(4000); throw Error('truncated'); }
    const out: Uint8Array[] = [];
    await expect((async () => { for await (const chunk of bufferSpeechStart(source())) out.push(chunk); })()).rejects.toThrow('truncated');
    expect(out).toEqual([]);
  });
  it('keeps a coalesced maximum-size event inside the browser chunk limit without losing bytes', async () => {
    const parts = [new Uint8Array(4500).fill(1), new Uint8Array(512 * 1024).fill(2)];
    async function* source() { yield* parts; }
    const out: Uint8Array[] = []; for await (const chunk of bufferSpeechStart(source())) out.push(chunk);
    expect(out.map(c => c.length)).toEqual([512 * 1024, 4500]);
    expect(Buffer.concat(out)).toEqual(Buffer.concat(parts));
  });
});
