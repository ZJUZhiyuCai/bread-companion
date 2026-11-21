import { readFileSync } from 'node:fs';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink, Input, OGG, OggOutputFormat, Output } from 'mediabunny';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as transcribeRoute } from '@/app/api/speech/transcribe/route';
import { POST as voiceRoute } from '@/app/api/agent/voice/route';
import { buildTurn } from '@/domain/context-builder';
import { CALL_SEED_BYTES, callSeedSchema, callSource, completeCallSeed, createCallSeed } from '@/domain/call-pipeline';
import { initialState, reducer } from '@/domain/reducer';
import { turnRequestSchema } from '@/domain/schemas';
import type { Source } from '@/domain/types';
import { resetLimitsForTest } from '@/server/limits';
import { resetCircuitsForTest } from '@/server/resilience';
import { withServerRuntime } from '@/server/runtime';
import { validateOpus } from '@/server/providers/opus-upload';
import { validateWav } from '@/server/providers/speech';
import { encodeWav } from '@/services/media-controller';

const interview = () => reducer(initialState('session_seed', 'case_seed'), { type: 'START_INTERVIEW', style: 'realistic', role: '前端开发' });
const jd = (index = 0): Source => ({ id: 'jd_' + index, revision: 1, origin: 'source_quote', label: '职位描述', text: '维护 React 页面，优化加载速度。', confirmed: true });
const wav = (seconds: number) => new File([encodeWav(new Float32Array(16000 * seconds))], 'answer.wav', { type: 'audio/wav' });
const signal = () => new AbortController().signal;

describe('bounded interview snapshots', () => {
  it('reconstructs the identical call request with four pasted materials and the latest answer', () => {
    let state = interview();
    for (let i = 0; i < 4; i++) state = reducer(state, { type: 'ADD_SOURCE', source: jd(i) });
    state = { ...state, interview: { ...state.interview!, stage: 'question', round: 1, currentQuestion: '你怎样定位页面性能问题？' } };
    const seed = createCallSeed(state)!;
    expect(seed.mode).toBe('interview');
    expect(seed.interview).toEqual(state.interview);
    expect(seed.sources).toHaveLength(4);
    expect(callSeedSchema.parse(seed)).toEqual(seed);
    const text = '我参与过 React 首屏性能的优化。';
    const after = reducer(state, { type: 'USER', text, source: callSource(text, seed.sourceId) });
    const expected = turnRequestSchema.parse({ ...buildTurn(after, text, seed.runId, seed.requestId), channel: 'call' });
    const reconstructed = completeCallSeed(seed, text);
    expect(JSON.stringify(reconstructed)).toBe(JSON.stringify(expected));
    expect(reconstructed?.context.sourceSegments?.[0]).toMatchObject({ sourceId: seed.sourceId, text });
    expect(reconstructed?.context.sourceSegments?.some(s => s.sourceId.startsWith('jd_'))).toBe(true);
  });

  it('returns voice controls to the controller while keeping reported speech eligible for a turn', () => {
    const seed = createCallSeed(interview())!;
    for (const command of ['开始模拟面试', '回到聊聊', '结束面试', '严格一点', '温和一点', '按真实面试来']) expect(completeCallSeed(seed, command)).toBeNull();
    expect(completeCallSeed(seed, '面试官说“严格一点”。')?.mode).toBe('interview');
  });

  it('rejects amended material, debrief seeds, excess materials and conflicting mode context', () => {
    const state = interview();
    const seed = createCallSeed(state)!;
    expect(callSeedSchema.safeParse({ ...seed, mode: 'listen' }).success).toBe(false);
    expect(callSeedSchema.safeParse({ ...seed, interview: undefined }).success).toBe(false);
    expect(callSeedSchema.safeParse({ ...seed, interview: { ...seed.interview, stage: 'debrief' } }).success).toBe(false);
    expect(callSeedSchema.safeParse({ ...seed, sources: [{ ...jd(), revision: 2 }] }).success).toBe(false);
    expect(createCallSeed(reducer(state, { type: 'REQUEST_INTERVIEW_DEBRIEF' }))).toBeNull();
    expect(createCallSeed({ ...state, sources: [{ ...jd(), revision: 2 }] })).toBeNull();
    expect(createCallSeed({ ...state, rejectedFindings: [{ text: '已撤回的判断', mode: 'interview', sources: [] }] })).toBeNull();
    expect(createCallSeed({ ...state, sources: Array.from({ length: 5 }, (_, i) => jd(i)) })).toBeNull();
    const oversized = [0, 1].map(i => ({ ...jd(i), text: '长'.repeat(11000) }));
    expect(new TextEncoder().encode(JSON.stringify(oversized)).length).toBeGreaterThan(CALL_SEED_BYTES);
    expect(createCallSeed({ ...state, sources: oversized })).toBeNull();
  });
});

describe('profile-aware speech upload', () => {
  beforeEach(() => {
    resetLimitsForTest(); resetCircuitsForTest();
    vi.stubEnv('BREAD_PUBLIC_ORIGIN', ''); vi.stubEnv('AGENT_PROVIDER', 'mock'); vi.stubEnv('MOCK_DELAY_MS', '1');
    vi.stubEnv('ASR_PROVIDER', 'minimax'); vi.stubEnv('TTS_PROVIDER', 'minimax'); vi.stubEnv('MINIMAX_API_KEY', 'fixture-only');
  });
  afterEach(() => vi.unstubAllEnvs());

  const asrRequest = (file: File, profile?: string | File, duplicate = false) => {
    const form = new FormData();
    form.set('requestId', 'request_profile_' + crypto.randomUUID());
    form.set('file', file);
    if (profile !== undefined) form.set('profile', profile);
    if (duplicate) form.append('profile', 'chat');
    return new Request('http://localhost:3210/api/speech/transcribe', { method: 'POST', body: form });
  };

  it('admits a 125-second WAV only for interview and rejects anything longer before billing', async () => {
    const file = wav(125);
    const provider = vi.fn(async () => Response.json({ text: '这是完整回答。', duration: 125 }));
    await expect(validateWav(wav(65))).resolves.toBeUndefined();
    await expect(validateWav(file)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    const responses = await withServerRuntime({ env: process.env, providerFetch: provider }, async () => {
      return [
        await transcribeRoute(asrRequest(file)),
        await transcribeRoute(asrRequest(file, 'chat')),
        await transcribeRoute(asrRequest(file, 'interview')),
        await transcribeRoute(asrRequest(wav(125.1), 'interview')),
      ];
    });
    expect(responses.map(res => res.status)).toEqual([415, 415, 200, 415]);
    expect(await responses[2].json()).toMatchObject({ text: '这是完整回答。', confirmed: false });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown, duplicated or non-text profiles without calling ASR', async () => {
    const provider = vi.fn();
    const file = wav(1);
    await withServerRuntime({ env: process.env, providerFetch: provider }, async () => {
      for (const req of [asrRequest(file, 'long'), asrRequest(file, file), asrRequest(file, 'interview', true)]) {
        const res = await transcribeRoute(req);
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
      }
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('also checks the provider-reported duration against the selected profile', async () => {
    const provider = vi.fn(async () => Response.json({ text: '这是完整回答。', duration: 90 }));
    const responses = await withServerRuntime({ env: process.env, providerFetch: provider }, async () => {
      return [await transcribeRoute(asrRequest(wav(1), 'chat')), await transcribeRoute(asrRequest(wav(1), 'interview'))];
    });
    expect(responses.map(res => res.status)).toEqual([415, 200]);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('applies the longer ASR ceiling to multipart interview turns and still emits the checked draft afterward', async () => {
    const seed = createCallSeed(interview())!;
    const form = new FormData();
    form.set('seed', JSON.stringify(seed)); form.set('file', wav(110));
    const req = new Request('http://localhost:3210/api/agent/voice', { method: 'POST', body: form });
    const provider = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/speech_to_text')) return Response.json({ text: '我参与过 React 页面性能优化。', duration: 110 });
      expect(String(url)).toMatch(/\/t2a_v2$/);
      return Response.json({ base_resp: { status_code: 0 }, data: { status: 2, audio: '494433' } });
    });
    const events = await withServerRuntime({ env: process.env, providerFetch: provider }, async () => {
      return (await (await voiceRoute(req)).text()).trim().split('\n').map(line => JSON.parse(line));
    });
    expect(events.map(e => e.type)).toEqual(['transcript', 'candidate', 'audio', 'done']);
    expect(events[1].candidate).toMatchObject({ contextRevision: seed.contextRevision + 1, findings: [], interviewUpdate: { stage: 'question' } });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('accepts 125 seconds of real Opus packets in the higher profile without weakening either duration cutoff', async () => {
    const blob = new Blob([new Uint8Array(readFileSync('tests/fixtures/voice-input.opus'))]);
    const input = new Input({ source: new BlobSource(blob), formats: [OGG] });
    const makeOpus = async (seconds: number) => {
      const track = (await input.getPrimaryAudioTrack())!;
      const decoderConfig = (await track.getDecoderConfig())!;
      const packet = (await new EncodedPacketSink(track).getFirstPacket())!;
      const source = new EncodedAudioPacketSource('opus'), target = new BufferTarget();
      const output = new Output({ format: new OggOutputFormat(), target });
      output.addAudioTrack(source);
      await output.start();
      for (let i = 0; i < seconds * 50; i++) await source.add(new EncodedPacket(packet.data, 'key', i * .02, .02), { decoderConfig });
      await output.finalize();
      return new File([target.buffer!], 'long.opus', { type: 'audio/ogg' });
    };
    try {
      const file = await makeOpus(125);
      await expect(validateOpus(file, signal())).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
      await expect(validateOpus(file, signal(), 125)).resolves.toBeUndefined();
      await expect(validateOpus(await makeOpus(126), signal(), 125)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    } finally { input.dispose(); }
  });
});
