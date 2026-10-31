import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTurn, CONTEXT_LIMITS } from '@/domain/context-builder';
import { initialState, reducer } from '@/domain/reducer';
import { locateEvidence, validateCandidate } from '@/domain/evidence';
import { conversationPreferences } from '@/domain/preferences';
import { responseStyleErrors } from '@/domain/response-style';
import { turnRequestSchema } from '@/domain/schemas';
import { requestFixture, sampleSource } from '@/fixtures/scenarios';
import { mockCandidate } from '@/server/providers/mock-agent';
import { RealProvider } from '@/server/providers/real-agent';
import { BreadController } from '@/services/bread-controller';
import { fetchComplete } from '@/services/http';
import { readBytes } from '@/server/http';
import { readProviderJson } from '@/server/providers/response';
import { claimRequest, resetLimitsForTest } from '@/server/limits';
import { POST } from '@/app/api/agent/turn/route';
import type { TurnRequest } from '@/domain/types';

const req = (body: unknown) => new Request('http://localhost:3210/api/agent/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); resetLimitsForTest(); });

describe('bounded, traceable context', () => {
  it('packs 24 long documents and 1000 turns below the wire budget while retaining relevant late segments', () => {
    let state = initialState(); state.mode = 'review';
    state.sources = Array.from({ length: 24 }, (_, i) => ({ ...sampleSource, id: `material_${i}`, text: '无关背景'.repeat(4500) + (i === 0 ? '关键规范：压测温度目标为八十度。' : '普通结束。') }));
    for (let i = 0; i < 1000; i++) state = reducer(state, { type: 'USER', text: `今天的日常${i}。`, source: { ...sampleSource, id: `chat_${i}`, label: '我说的话', text: `今天的日常${i}。` } });
    const turn = buildTurn(state, '压测温度目标是什么？', 'run_long', 'request_long');
    expect(turnRequestSchema.safeParse(turn).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(turn))).toBeLessThanOrEqual(CONTEXT_LIMITS.wireBytes);
    expect(turn.context.sources).toEqual([]); expect(turn.context.sourceSegments!.length).toBeLessThanOrEqual(6);
    const target = turn.context.sourceSegments!.find(s => s.text.includes('压测温度目标'))!;
    expect(target).toBeDefined(); expect(target.segmentId).not.toMatch(/:s0$/);
    expect(locateEvidence(state.sources, { ...target, quote: '压测温度目标为八十度' })).toBe(true);
    const result = mockCandidate(turn);
    expect(validateCandidate(result, turn)).toEqual([]);
    for (const f of result.findings) for (const ref of f.evidenceRefs) expect(locateEvidence(state.sources, ref)).toBe(true);
    result.findings[0].evidenceRefs[0].quote = '没有出现的原话';
    expect(validateCandidate(result, turn)).toContain('EVIDENCE_MISMATCH');
  });
  it('enforces UTF-8 budget for maximal Chinese input and emoji without splitting evidence', () => {
    const state = initialState(); state.selectedQuestion = '问'.repeat(1000); state.practiceCriteria = ['关注点'];
    state.sources = [{ ...sampleSource, text: '🥯'.repeat(9000) }];
    state.messages = Array.from({ length: 16 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? 'user' : 'assistant', text: '中'.repeat(4000) }));
    const turn = buildTurn(state, '说'.repeat(4000), 'run_utf8', 'request_utf8');
    expect(Buffer.byteLength(JSON.stringify(turn))).toBeLessThanOrEqual(CONTEXT_LIMITS.wireBytes);
    expect(turnRequestSchema.safeParse(turn).success).toBe(true);
    expect(turn.context.sourceSegments!.every(s => !s.text.includes('\ufffd'))).toBe(true);
  });
  it('rejects ambiguous full sources plus selected segments and duplicate segment identities', () => {
    const state = initialState(); state.sources = [sampleSource]; const turn = buildTurn(state, '看看材料', 'run_segments', 'req_segments');
    expect(turnRequestSchema.safeParse({ ...turn, context: { ...turn.context, sources: [sampleSource] } }).success).toBe(false);
    turn.context.sourceSegments!.push(turn.context.sourceSegments![0]);
    expect(turnRequestSchema.safeParse(turn).success).toBe(false);
  });
  it('retains explicit preferences beyond recent history, respects changes/corrections, and clears on end', () => {
    let state = initialState();
    const say = (text: string, i: number) => { state = reducer(state, { type: 'USER', text, source: { ...sampleSource, id: `s${i}`, text } }); };
    say('我今晚不想听建议。别再问我问题。', 0);
    for (let i = 1; i <= 30; i++) say(`随便聊聊${i}`, i);
    expect(buildTurn(state, '接着说', 'run_pref', 'req_pref').context.preferences).toEqual({ advice: 'on_request', questions: 'avoid' });
    say('现在可以给我一个建议。你可以问我问题。', 31);
    expect(conversationPreferences(state.messages)).toEqual({ advice: 'welcome', questions: 'allowed' });
    state = reducer(state, { type: 'CORRECT_SOURCE', id: 's31', text: '打错了，随便聊聊就好。' });
    expect(conversationPreferences(state.messages)).toEqual({ advice: 'on_request', questions: 'avoid' });
    expect(conversationPreferences(reducer(state, { type: 'END' }).messages)).toEqual({});
    expect(conversationPreferences([{ role: 'user', text: '他跟我说“别问我问题，不要给我建议”。' }])).toEqual({});
    expect(conversationPreferences([{ role: 'user', text: '只想吐槽，不用给建议，也别一直问我。' }])).toEqual({ advice: 'on_request', questions: 'avoid' });
    expect(conversationPreferences([{ role: 'user', text: '今天有点累，不想听建议。别问我问题。' }])).toEqual({ advice: 'on_request', questions: 'avoid' });
    expect(conversationPreferences([{ role: 'user', text: '他不想听建议。我不知道要不要听建议。' }])).toEqual({});
  });
});

it('rejects unsolicited questions after an explicit no-questions preference', () => {
  const input = requestFixture({ mode: 'listen', userMessage: '今天发呆了。' }); input.context.preferences = { questions: 'avoid' };
  expect(responseStyleErrors('今天遇到什么了吗？', input)).toContain('STYLE_RESPECT_NO_QUESTIONS');
  expect(responseStyleErrors('那就一起发会儿呆。', input)).toEqual([]);
  expect(responseStyleErrors('想聊什么？', { ...input, userMessage: '问我一个问题吧。' })).toEqual([]);
});

describe('recovery owns one user turn', () => {
  it('retries with fresh ids and no duplicated user message/source; repeated taps start only once', async () => {
    const inputs: TurnRequest[] = []; let finish!: (r: Response) => void;
    const fetcher = vi.fn(async (_url, init) => {
      inputs.push(JSON.parse(init!.body as string));
      return inputs.length === 1 ? Response.json({ error: { retryable: true, userMessage: '稍后再试' } }, { status: 503 }) : new Promise<Response>(r => { finish = r; });
    });
    const c = new BreadController(fetcher); await c.send('今天有点累。');
    expect(c.getSnapshot().canRetry).toBe(true);
    const retry = c.retryLastTurn(); const duplicate = c.retryLastTurn();
    expect(fetcher).toHaveBeenCalledTimes(2); finish(Response.json(mockCandidate(inputs[1]))); await Promise.all([retry, duplicate]);
    expect(c.getSnapshot().error).toBe(''); expect(c.getSnapshot().canRetry).toBe(false);
    expect(c.getSnapshot().state.messages.filter(m => m.role === 'user')).toHaveLength(1);
    expect(c.getSnapshot().state.sources).toHaveLength(1); expect(inputs[1].requestId).not.toBe(inputs[0].requestId); expect(inputs[1].runId).not.toBe(inputs[0].runId);
  });
  it.each(['stop', 'end', 'material', 'mode'] as const)('invalidates a retry after %s', async action => {
    const fetcher = vi.fn(async () => Response.json({ error: { retryable: true, userMessage: '稍后再试' } }, { status: 503 }));
    const c = new BreadController(fetcher); await c.send('今天有点累。');
    if (action === 'stop') c.stop(); else if (action === 'end') c.end(); else if (action === 'material') c.addMaterial('后来补充的材料。'); else c.setMode('review');
    await c.retryLastTurn(); expect(fetcher).toHaveBeenCalledTimes(1); expect(c.getSnapshot().canRetry).toBe(false);
  });
  it('long chatting does not consume the 24 material slots', async () => {
    const c = new BreadController(async (_url, init) => Response.json(mockCandidate(JSON.parse(init!.body as string))));
    for (let i = 0; i < 30; i++) await c.send(`我说一点日常${i}。`);
    expect(c.addMaterial('岗位要求和一段面试回答。')).toBe(true); expect(c.getSnapshot().error).toBe('');
  });
});

describe('deadlines and duplicate billing prevention', () => {
  it('settles a hung client fetch and a hung response body within the same deadline', async () => {
    vi.useFakeTimers();
    for (const fetcher of [async () => new Promise<Response>(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
      const pending = fetchComplete(fetcher, '/api/agent/turn', undefined, 50);
      const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(51); await rejected;
    }
  });
  it('aborts a stalled request body even when its cancel hook never settles', async () => {
    const aborter = new AbortController(); const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({ start() {}, cancel });
    const request = new Request('http://localhost:3210/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    const pending = readBytes(request, 128, aborter.signal);
    aborter.abort(new DOMException('deadline', 'TimeoutError'));
    await expect(pending).rejects.toMatchObject({ name: 'TimeoutError' }); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('aborts stalled upstream JSON instead of waiting indefinitely after headers', async () => {
    const aborter = new AbortController(); const res = new Response(new ReadableStream({ start() {} }));
    const pending = readProviderJson(res, 1000, aborter.signal); aborter.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('releases route capacity when the provider ignores its deadline', async () => {
    vi.stubEnv('AGENT_PROVIDER', 'real');
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let entered!: () => void; const ready = new Promise<void>(r => { entered = r; });
    const generate = vi.spyOn(RealProvider.prototype, 'generate').mockImplementation(() => { entered(); return new Promise(() => {}); });
    const pending = POST(req(requestFixture())); await ready;
    deadline.abort(new DOMException('deadline', 'TimeoutError'));
    const res = await pending; expect(res.status).toBe(504); expect((await res.json()).error.retryable).toBe(true);
    vi.restoreAllMocks(); vi.stubEnv('AGENT_PROVIDER', 'mock'); vi.stubEnv('MOCK_DELAY_MS', '1');
    const results = await Promise.all([1, 2, 3].map(i => POST(req(requestFixture({ requestId: `req_released_${i}` })))));
    expect(results.map(r => r.status)).toEqual([200, 200, 200]); expect(generate).toHaveBeenCalledTimes(1);
  });
  it('rejects a repeated request id before a second provider call, without caching content', async () => {
    vi.stubEnv('AGENT_PROVIDER', 'mock'); vi.stubEnv('MOCK_DELAY_MS', '1');
    const one = await POST(req(requestFixture())); const two = await POST(req(requestFixture()));
    expect(one.status).toBe(200); expect(two.status).toBe(409);
    expect(one.headers.get('server-timing')).toMatch(/provider;dur=/);
    expect((await two.json()).error.code).toBe('DUPLICATE_REQUEST');
    expect(() => claimRequest('fixture', 'id', 1000)).not.toThrow(); expect(() => claimRequest('fixture', 'id', 1001)).toThrow();
    expect(() => claimRequest('fixture', 'id', 601001)).not.toThrow();
  });
});
