import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/agent/voice/route';
import { initialState, reducer } from '@/domain/reducer';
import { capabilitiesSchema } from '@/domain/schemas';
import type { TurnRequest } from '@/domain/types';
import { requestFixture } from '@/fixtures/scenarios';
import * as generation from '@/server/agent-turn';
import { getCapabilities } from '@/server/config';
import { acquireBudget, resetLimitsForTest } from '@/server/limits';
import { mockCandidate } from '@/server/providers/mock-agent';
import { resetCircuitsForTest } from '@/server/resilience';
import { withServerRuntime } from '@/server/runtime';

const listening = () => requestFixture({ mode: 'listen', channel: 'call', userMessage: '等了很久才收到很简短的拒信。' });
const interview = () => {
  const state = reducer(initialState(), { type: 'START_INTERVIEW', style: 'realistic' });
  return { ...listening(), mode: 'interview' as const, context: { ...listening().context, interview: state.interview! }, userMessage: '开始模拟面试' };
};
const req = (input = listening(), audio = 'pcm-s16le-v1', header = true) => new Request('http://localhost:3210/api/agent/voice', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bread-Audio': audio, ...(header ? { 'X-Bread-Voice-Stream': 'sentence-v1' } : {}) }, body: JSON.stringify(input),
});
const encode = new TextEncoder();
const decoder = new TextDecoder();
const voiceReply = (status: number, bytes: number[], format = 'pcm') => sseData({
  base_resp: { status_code: 0 },
  data: { status, audio: Buffer.from(bytes).toString('hex') },
  ...(status === 2 ? { extra_info: { audio_format: format, audio_sample_rate: 32000, audio_channel: 1 } } : {}),
});
const sseData = (payload: unknown) => 'data: ' + JSON.stringify(payload) + '\r\n\r\n';
const openAiText = (text: string) => sseData({ choices: [{ delta: { content: text } }] });
const anthropicText = (text: string) => sseData({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
const sse = (body: BodyInit) => new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
const postWith = (request: Request, providerFetch: typeof fetch) => withServerRuntime({ env: process.env, providerFetch }, () => POST(request));

function controlledSse() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn(), pull = vi.fn();
  const body = new ReadableStream<Uint8Array>({ start(c) { writer = c; }, cancel, pull });
  return {
    response: sse(body), cancel, pull,
    send(text: string, fragmentSize = 4096) {
      const bytes = encode.encode(text);
      for (let at = 0; at < bytes.length; at += fragmentSize) writer.enqueue(bytes.subarray(at, at + fragmentSize));
    },
    close() { writer.close(); },
  };
}
function responseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  return {
    async next() {
      const part = await reader.read();
      return part.done ? undefined : JSON.parse(decoder.decode(part.value));
    },
    cancel: () => reader.cancel(),
  };
}
async function allEvents(response: Response) {
  return (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
function availableSlots(lane: string, count: number) {
  const release: (() => void)[] = [];
  try { for (let i = 0; i < count; i++) release.push(acquireBudget(lane)); }
  finally { release.forEach(done => done()); }
}

beforeEach(() => {
  resetLimitsForTest(); resetCircuitsForTest();
  for (const [key, value] of Object.entries({
    BREAD_PUBLIC_ORIGIN: '', AGENT_PROVIDER: 'real', AGENT_API_KEY: 'analysis-fixture', AGENT_BASE_URL: 'https://analysis.example/v1',
    AGENT_PROTOCOL: 'openai', AGENT_COMPANION_BASE_URL: '', AGENT_COMPANION_MODEL: '', AGENT_CALL_MODEL: '', AGENT_CALL_PROTOCOL: '',
    BREAD_COMBINED_VOICE: '', BREAD_STREAM_VOICE_LLM: '', BREAD_SPEECH_START_BUFFER: '', BREAD_PCM_STREAM: '', BREAD_MP3_STREAM: '',
    TTS_PROVIDER: 'minimax', MINIMAX_API_KEY: 'tts-fixture', MINIMAX_BASE_URL: 'https://speech.example/v1',
  })) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

describe('sentence voice orchestration', () => {
  it('plays verified PCM before model completion and releases the call lane while queued speech drains', async () => {
    const model = controlledSse(), speech = controlledSse();
    const utterance1 = '等了这么久才收到一句话。', utterance2 = '这一下挺不好受的。';
    const ttsTexts: string[] = [];
    const provider = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(init?.redirect).toBe('manual');
      expect(body.stream).toBe(true);
      if (String(url).endsWith('/chat/completions')) return model.response;
      ttsTexts.push(body.text);
      return ttsTexts.length === 1 ? speech.response : sse(voiceReply(2, [4, 0]));
    });
    const response = await postWith(req(), provider);
    const events = responseEvents(response.body!);
    model.send(openAiText('{"assistantText":"' + utterance1 + utterance2[0]), 7);
    expect(await events.next()).toMatchObject({ type: 'delta', text: utterance1 });
    speech.send(voiceReply(1, [1, 0]), 11);
    expect(await events.next()).toMatchObject({ type: 'audio_start', format: 'pcm-s16le', sampleRate: 32000, channels: 1 });
    expect(await events.next()).toMatchObject({ type: 'audio_chunk', sequence: 0, audio: 'AQA=' });
    expect(ttsTexts).toEqual([utterance1]);
    expect(() => availableSlots('call', 3)).toThrow();
    expect(() => availableSlots('tts', 3)).toThrow();

    model.send(openAiText(utterance2.slice(1) + '","supportGuidance":false}') + 'data: [DONE]\n\n');
    model.close();
    expect(await events.next()).toMatchObject({ type: 'candidate', candidate: { assistantText: utterance1 + utterance2, findings: [], serviceMode: 'real' } });
    await vi.waitFor(() => expect(() => availableSlots('call', 3)).not.toThrow());
    expect(ttsTexts).toEqual([utterance1]);
    speech.send(voiceReply(2, [2, 0]));
    speech.close();
    expect(await events.next()).toMatchObject({ type: 'audio_chunk', sequence: 1, audio: 'AgA=' });
    expect(await events.next()).toMatchObject({ type: 'delta', text: utterance2 });
    expect(await events.next()).toMatchObject({ type: 'audio_chunk', sequence: 2, audio: 'BAA=' });
    expect(await events.next()).toMatchObject({ type: 'done', timing: {
      firstSentenceMs: expect.any(Number), firstAudioMs: expect.any(Number), agentMs: expect.any(Number), ttsMs: expect.any(Number), totalMs: expect.any(Number),
    } });
    expect(await events.next()).toBeUndefined();
    expect(ttsTexts).toEqual([utterance1, utterance2]);
    expect(() => availableSlots('tts', 3)).not.toThrow();
  });

  it('streams Anthropic interview text and coalesces deferred sentences into one MP3 synthesis call', async () => {
    vi.stubEnv('AGENT_CALL_MODEL', 'call-fixture');
    vi.stubEnv('AGENT_CALL_PROTOCOL', 'anthropic');
    const turn = interview();
    const opener = '我们来聊一次评测。', question = '你怎样判断它能发现真实问题？';
    const characters = [
      anthropicText('{"assistantText":"' + opener),
      anthropicText(question + '","interviewUpdate":{"stage":"question","question":"' + question + '","focusPoints":["评测标准"]},"findings":[]}'),
      sseData({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }), sseData({ type: 'message_stop' }),
    ];
    const tag = [73, 68, 51, 3, 0, 0, 0, 0, 0, 2, 7, 8];
    const frame = [255, 227, 1, 0];
    const ttsCalls: string[] = [];
    const provider = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/messages')) {
        expect(body).toMatchObject({ model: 'call-fixture', stream: true });
        expect(body.system).toContain('真实深挖');
        expect(JSON.parse(body.messages[0].content).interview).toEqual(turn.context.interview);
        return sse(characters.join(''));
      }
      expect(body.audio_setting.format).toBe('mp3');
      ttsCalls.push(body.text);
      return sse(voiceReply(1, tag.slice(0, 5), 'mp3') + voiceReply(2, [...tag.slice(5), ...frame], 'mp3'));
    });
    const events = await allEvents(await postWith(req(turn, 'mp3-chunks-v1'), provider));
    expect(events[0].type).toBe('candidate');
    expect(ttsCalls).toEqual([opener + question]);
    expect(events.filter(e => e.type === 'delta').map(e => e.text)).toEqual([opener + question]);
    expect(events.filter(e => e.type === 'audio_start')).toEqual([{ type: 'audio_start', requestId: turn.requestId, format: 'mp3', sampleRate: 32000, channels: 1 }]);
    const audio = events.filter(e => e.type === 'audio_chunk');
    expect(audio.map(e => e.sequence)).toEqual([0]);
    expect(Buffer.concat(audio.map(e => Buffer.from(e.audio, 'base64')))).toEqual(Buffer.from([...tag, ...frame]));
    expect(events.find(e => e.type === 'candidate').candidate.interviewUpdate).toMatchObject({ stage: 'question', question });
    expect(events.at(-1).type).toBe('done');
  });

  it('coalesces the first MP3 and removes split ID3v2 tags from later early-streamed listen sentences', async () => {
    const turn = listening();
    const first = '等了一周只收到四个字。', second = '这落差确实不好受。';
    const tag = [73, 68, 51, 3, 0, 0, 0, 0, 0, 2, 7, 8];
    const frames = [[255, 227, 1, 0], [255, 227, 2, 0]];
    const provider = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/chat/completions')) {
        return sse(openAiText('{"assistantText":"' + first) + openAiText(second + '","supportGuidance":false}') + 'data: [DONE]\n\n');
      }
      const frame = body.text === first ? frames[0] : frames[1];
      return sse(voiceReply(1, tag.slice(0, 5), 'mp3') + voiceReply(2, [...tag.slice(5), ...frame], 'mp3'));
    });
    const events = await allEvents(await postWith(req(turn, 'mp3-chunks-v1'), provider));
    expect(events.filter(e => e.type === 'delta').map(e => e.text)).toEqual([first, second]);
    const audio = events.filter(e => e.type === 'audio_chunk');
    expect(audio.map(e => e.sequence)).toEqual([0, 1]);
    expect(Buffer.concat(audio.map(e => Buffer.from(e.audio, 'base64')))).toEqual(Buffer.from([...tag, ...frames[0], ...frames[1]]));
    expect(events.at(-1).type).toBe('done');
  });

  it.each(['debrief', 'findings only'])('never speaks an unauthorized interview %s, even with sentence-stream opt-in', async kind => {
    const input = interview();
    Object.assign(input.context.interview!, { stage: 'question', round: 1, currentQuestion: '如何验证结果？' });
    const answer = {
      assistantText: '这一场提前结束。我们现在复盘。',
      interviewUpdate: kind === 'debrief' ? { stage: 'debrief' } : { stage: 'follow_up', question: '怎么验证？' },
      findings: [{ id: 'f1', kind: 'unknown', text: '招聘结果未知。' }],
      ...(kind === 'debrief' ? { card: { type: 'review', title: '提前复盘', sections: [{ key: '未知', text: '招聘结果未知。', findingIds: ['f1'] }] } } : {}),
    };
    const tts = vi.fn(), serialized = JSON.stringify(answer);
    const provider = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/t2a_v2')) { tts(); return sse(voiceReply(2, [1, 0])); }
      if (JSON.parse(String(init?.body)).stream) return sse(openAiText(serialized) + 'data: [DONE]\n\n');
      return Response.json({ choices: [{ message: { content: serialized } }] });
    });
    const events = await allEvents(await postWith(req(input), provider));
    expect(events.map(e => e.type)).toEqual(['error']);
    expect(events[0].error).toMatchObject({ stage: 'agent', code: 'INVALID_MODEL_OUTPUT' });
    expect(tts).not.toHaveBeenCalled();
  });

  it('cancels both streaming bodies and frees both leases when the browser cancels playback', async () => {
    const model = controlledSse(), speech = controlledSse(), signals: AbortSignal[] = [];
    const provider = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init!.signal!);
      return String(url).endsWith('/chat/completions') ? model.response : speech.response;
    });
    const body = (await postWith(req(), provider)).body!;
    const events = responseEvents(body);
    model.send(openAiText('{"assistantText":"这份等待挺难熬的。还'));
    expect(await events.next()).toMatchObject({ type: 'delta' });
    speech.send(voiceReply(1, [1, 0]));
    expect(await events.next()).toMatchObject({ type: 'audio_start' });
    expect(await events.next()).toMatchObject({ type: 'audio_chunk' });
    await events.cancel();
    await vi.waitFor(() => {
      expect(signals.map(s => s.aborted)).toEqual([true, true]);
      expect(model.cancel).toHaveBeenCalledOnce(); expect(speech.cancel).toHaveBeenCalledOnce();
      expect(() => availableSlots('call', 3)).not.toThrow(); expect(() => availableSlots('tts', 3)).not.toThrow();
    });
  });

  it.each(['invalid candidate', 'unsafe second sentence', 'upstream error', 'changed speech field'])('cuts off speech without emitting a candidate or retrying after %s', async kind => {
    const model = controlledSse(), speech = controlledSse();
    const provider = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/chat/completions') ? model.response : speech.response);
    const events = responseEvents((await postWith(req(), provider)).body!);
    model.send(openAiText('{"assistantText":"这份等待挺难熬的。还'));
    expect(await events.next()).toMatchObject({ type: 'delta' });
    speech.send(voiceReply(1, [1, 0]));
    expect(await events.next()).toMatchObject({ type: 'audio_start' });
    expect(await events.next()).toMatchObject({ type: 'audio_chunk' });
    if (kind === 'upstream error') model.send(sseData({ error: { message: 'upstream secret' } }));
    else {
      const tail = kind === 'invalid candidate' ? '","interviewUpdate":{"stage":"debrief"}}'
        : kind === 'changed speech field' ? '","assistantText":"后来改掉的另一句话。"}'
        : '只有我才懂你。"}';
      model.send(openAiText(tail) + 'data: [DONE]\n\n');
    }
    expect(await events.next()).toMatchObject({ type: 'error', error: { stage: 'agent', code: kind === 'upstream error' ? 'PROVIDER_UNAVAILABLE' : 'INVALID_MODEL_OUTPUT' } });
    expect(await events.next()).toBeUndefined();
    expect(speech.cancel).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledTimes(2);
    expect(() => availableSlots('call', 3)).not.toThrow(); expect(() => availableSlots('tts', 3)).not.toThrow();
  });

  it('reports broken synthesis while the model is still running and skips queued and later sentences', async () => {
    const model = controlledSse(), speech = controlledSse();
    const first = '这份等待挺难熬的。', second = '可以先让自己休息一下。', third = '等准备好了再聊。';
    const tts = vi.fn(), input = listening();
    let agentSignal!: AbortSignal, speechSignal!: AbortSignal;
    const provider = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/chat/completions')) { agentSignal = init!.signal!; return model.response; }
      speechSignal = init!.signal!;
      tts(JSON.parse(String(init?.body)).text);
      return speech.response;
    });
    const events = responseEvents((await postWith(req(input), provider)).body!);
    model.send(openAiText('{"assistantText":"' + first + second + third[0]));
    expect(await events.next()).toMatchObject({ type: 'delta', text: first });
    speech.send(voiceReply(1, [1, 0]));
    expect(await events.next()).toMatchObject({ type: 'audio_start' });
    expect(await events.next()).toMatchObject({ type: 'audio_chunk' });
    speech.send(sseData({ base_resp: { status_code: 1 } }));
    expect(await events.next()).toMatchObject({ type: 'error', error: { stage: 'synthesize', code: 'PROVIDER_UNAVAILABLE', retryable: true, requestId: input.requestId } });
    expect(speechSignal.aborted).toBe(true);
    expect(agentSignal.aborted).toBe(false);
    await vi.waitFor(() => expect(() => availableSlots('tts', 3)).not.toThrow());
    model.send(openAiText(third.slice(1) + '","supportGuidance":false}') + 'data: [DONE]\n\n');
    model.close();
    expect(await events.next()).toMatchObject({ type: 'candidate', candidate: { assistantText: first + second + third } });
    expect(await events.next()).toBeUndefined();
    expect(tts).toHaveBeenCalledExactlyOnceWith(first);
  });

  it('reports TTS admission failure before the candidate and sends no later speech', async () => {
    const model = controlledSse();
    const held = Array.from({ length: 3 }, () => acquireBudget('tts'));
    const provider = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/chat/completions') ? model.response : sse(voiceReply(2, [1, 0])));
    try {
      const events = responseEvents((await postWith(req(), provider)).body!);
      model.send(openAiText('{"assistantText":"这份等待挺难熬的。还'));
      expect(await events.next()).toMatchObject({ type: 'error', error: { stage: 'synthesize', code: 'RATE_LIMITED', retryable: true } });
      held.forEach(release => release());
      model.send(openAiText('可以慢慢说。"}') + 'data: [DONE]\n\n');
      model.close();
      expect(await events.next()).toMatchObject({ type: 'candidate' });
      expect(await events.next()).toBeUndefined();
      expect(provider).toHaveBeenCalledOnce();
    } finally { held.forEach(release => release()); }
  });

  it.each([true, false])('holds text past the normal limit until supportGuidance=%s is validated', async supportGuidance => {
    const model = controlledSse(), texts: string[] = [];
    const first = '字'.repeat(70) + '。', second = '话'.repeat(48) + '。';
    const provider = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/chat/completions')) return model.response;
      texts.push(JSON.parse(String(init?.body)).text);
      return sse(voiceReply(2, [1, 0]));
    });
    const events = responseEvents((await postWith(req(), provider)).body!);
    model.send(openAiText('{"assistantText":"' + first + second[0]));
    expect(await events.next()).toMatchObject({ type: 'delta', text: first });
    expect(await events.next()).toMatchObject({ type: 'audio_start' });
    expect(await events.next()).toMatchObject({ type: 'audio_chunk' });
    const before = model.pull.mock.calls.length;
    model.send(openAiText(second.slice(1) + '",'));
    await vi.waitFor(() => expect(model.pull.mock.calls.length).toBeGreaterThan(before));
    expect(texts).toEqual([first]);
    model.send(openAiText('"supportGuidance":' + supportGuidance + '}') + 'data: [DONE]\n\n');
    model.close();
    if (supportGuidance) {
      expect(await events.next()).toMatchObject({ type: 'candidate', candidate: { assistantText: first + second, supportGuidance: true } });
      expect(await events.next()).toMatchObject({ type: 'delta', text: second });
      expect(await events.next()).toMatchObject({ type: 'audio_chunk', sequence: 1 });
      expect(await events.next()).toMatchObject({ type: 'done' });
    } else {
      expect(await events.next()).toMatchObject({ type: 'error', error: { stage: 'agent', code: 'INVALID_MODEL_OUTPUT' } });
    }
    expect(await events.next()).toBeUndefined();
    expect(texts).toEqual(supportGuidance ? [first, second] : [first]);
  });

  it('repairs an unsafe first sentence once before any TTS, then synthesizes only the checked replacement', async () => {
    const good = '这份等待挺不好受的。';
    const provider = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/t2a_v2')) {
        expect(body.text).toBe(good);
        return sse(voiceReply(2, [1, 0]));
      }
      if (body.stream) return sse(openAiText('{"assistantText":"你怎么又搞砸了？"}') + 'data: [DONE]\n\n');
      expect(body.messages[0].content).toContain('上次回复的口播前缀未通过');
      return Response.json({ choices: [{ message: { content: JSON.stringify({ assistantText: good }) } }] });
    });
    const events = await allEvents(await postWith(req(), provider));
    expect(events.map(e => e.type)).toEqual(['candidate', 'audio_start', 'audio_chunk', 'done']);
    expect(events[0].candidate.assistantText).toBe(good);
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it('finishes a reordered but valid JSON candidate before sending any speech', async () => {
    const model = controlledSse();
    const provider = vi.fn(async (url: RequestInfo | URL) => String(url).endsWith('/chat/completions') ? model.response : sse(voiceReply(2, [1, 0])));
    const turn = postWith(req(), provider).then(allEvents);
    model.send(openAiText('{"warnings":[],"assistantText":"这份等待挺不好受的。"}') + 'data: [DONE]\n\n');
    model.close();
    const events = await turn;
    expect(events.map(e => e.type)).toEqual(['candidate', 'audio_start', 'audio_chunk', 'done']);
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe('explicit transport negotiation', () => {
  it.each(['no opt-in header', 'kill switch', 'combined voice off', 'mock', 'no chunk format', 'rejected finding', 'explicit debrief', 'final round'])('keeps the original checked path for %s', async kind => {
    let input: TurnRequest = listening();
    if (kind === 'kill switch') vi.stubEnv('BREAD_STREAM_VOICE_LLM', 'off');
    if (kind === 'combined voice off') vi.stubEnv('BREAD_COMBINED_VOICE', 'off');
    if (kind === 'mock') vi.stubEnv('AGENT_PROVIDER', 'mock');
    if (kind === 'rejected finding') input.context.rejectedFindings = [{ text: '已撤回', mode: 'review', sources: [] }];
    if (kind === 'explicit debrief' || kind === 'final round') {
      input = interview();
      const state = input.context.interview!;
      state.stage = kind === 'final round' ? 'question' : 'debrief';
      state.round = kind === 'final round' ? state.maxRounds : 0;
    }
    const candidate = mockCandidate(input);
    const generate = vi.spyOn(generation, 'generateTurn').mockResolvedValue({ candidate, providerMs: 3 });
    const provider = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toMatch(/\/t2a_v2$/);
      if (kind === 'no chunk format') return Response.json({ base_resp: { status_code: 0 }, data: { status: 2, audio: '494433' } });
      return sse(voiceReply(2, [1, 0]));
    });
    const events = await allEvents(await postWith(req(input, kind === 'no chunk format' ? '' : 'pcm-s16le-v1', kind !== 'no opt-in header'), provider));
    expect(events.map(e => e.type)).toEqual(kind === 'no chunk format' ? ['candidate', 'audio', 'done'] : ['candidate', 'audio_start', 'audio_chunk', 'done']);
    expect(generate).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledOnce();
  });

  it.each([['晚安', 'listen'], ['我现在准备伤害自己', 'interview']] as const)('keeps the deterministic reply for %s off the model lane', async (userMessage, mode) => {
    const input = { ...(mode === 'interview' ? interview() : listening()), userMessage };
    const provider = vi.fn(async (url: RequestInfo | URL) => {
      expect(String(url)).toMatch(/\/t2a_v2$/);
      return sse(voiceReply(2, [1, 0]));
    });
    const events = await allEvents(await postWith(req(input), provider));
    expect(events.map(e => e.type)).toEqual(['candidate', 'audio_start', 'audio_chunk', 'done']);
    if (mode === 'interview') expect(events[0].candidate).toMatchObject({ supportGuidance: true, findings: [] });
    else expect(events[0].candidate.assistantText).toBe('晚安。');
    expect(provider).toHaveBeenCalledOnce();
  });

  it('exposes only the safe capability bit and honors request-scoped Worker switches', () => {
    expect(capabilitiesSchema.parse(getCapabilities()).tts.sentenceStream).toBe(true);
    expect(JSON.stringify(getCapabilities())).not.toMatch(/analysis-fixture|tts-fixture|https:\/\/analysis/);
    expect(withServerRuntime({ env: { ...process.env, BREAD_STREAM_VOICE_LLM: 'off' } }, () => getCapabilities()).tts.sentenceStream).toBeUndefined();
    vi.stubEnv('BREAD_COMBINED_VOICE', 'off');
    expect(getCapabilities().tts.sentenceStream).toBeUndefined();
  });
});
