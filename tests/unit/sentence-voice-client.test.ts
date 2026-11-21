import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTurn } from '@/domain/context-builder';
import { createCallSeed } from '@/domain/call-pipeline';
import { initialState, reducer } from '@/domain/reducer';
import type { TurnRequest } from '@/domain/types';
import { mockCandidate } from '@/server/providers/mock-agent';
import { Mp3Speech } from '@/services/speech-stream';
import { requestAudioTurn, requestVoiceTurn, VoiceTransportUnavailable } from '@/services/voice-turn';

const makeInput = (mode: 'listen' | 'interview' = 'listen') => ({
  ...buildTurn(reducer(initialState(), { type: 'START', mode }), '我想试着把这段经历说清楚。', 'run_test', 'request_test'),
  channel: 'call' as const,
});

function transport() {
  const canceled = vi.fn();
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { writer = c; }, cancel: canceled });
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }));
  return {
    canceled, fetcher,
    send: (event: unknown) => writer.enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n')),
    close: () => writer.close(),
  };
}

const audioStart = (requestId: string) => ({ type: 'audio_start', requestId, format: 'mp3', sampleRate: 32000, channels: 1 });
const chunk = (requestId: string, sequence = 0) => ({ type: 'audio_chunk', requestId, sequence, audio: 'SUQzAA==' });
const error = (requestId: string, stage: string) => ({ type: 'error', error: { requestId, stage, userMessage: '声音暂时没接上。' } });

afterEach(() => vi.unstubAllGlobals());

describe('sentence voice negotiation', () => {
  it.each([
    ['listen', true],
    ['interview', true],
    ['debrief', false],
    ['last answer', false],
    ['practice', false],
    ['no capability', false],
    ['save-data', false],
  ] as const)('negotiates early sentences for %s only when eligible', async (kind, expected) => {
    const input: TurnRequest = makeInput(['interview', 'debrief', 'last answer'].includes(kind) ? 'interview' : 'listen');
    if (kind === 'debrief') input.context.interview!.stage = 'debrief';
    if (kind === 'last answer') input.context.interview!.round = input.context.interview!.maxRounds;
    if (kind === 'practice') input.mode = 'practice';
    if (kind === 'save-data') vi.stubGlobal('navigator', { connection: { saveData: true } });
    const fetcher = vi.fn(async (_u: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 404 }));
    const turn = requestVoiceTurn(fetcher, input, new AbortController().signal, { sentenceStream: kind !== 'no capability' });
    await expect(turn.candidate).rejects.toBeInstanceOf(VoiceTransportUnavailable);
    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.get('X-Bread-Voice-Stream')).toBe(expected ? 'sentence-v1' : null);
    expect(headers.get('X-Bread-Audio')).toBe(kind === 'save-data' ? null : 'mp3-chunks-v1');
  });

  it('negotiates a multipart interview and rejects early audio before its transcript', async () => {
    const seed = createCallSeed(reducer(initialState(), { type: 'START_INTERVIEW' }))!;
    const file = new File(['synthetic audio'], 'speech.wav', { type: 'audio/wav' });
    const h = transport();
    const turn = requestAudioTurn(h.fetcher, seed, file, new AbortController().signal, { sentenceStream: true });
    const request = h.fetcher.mock.calls[0][1]!;
    expect(request.body).toBeInstanceOf(FormData);
    expect(new Headers(request.headers).get('X-Bread-Voice-Stream')).toBe('sentence-v1');
    h.send(audioStart(seed.requestId));
    await expect(turn.transcript).rejects.toThrow('声音连接中断');
    await expect(turn.candidate).rejects.toThrow('声音连接中断');
    await expect(turn.audio).rejects.toThrow('声音连接中断');
  });
});

describe('sentence voice stream', () => {
  it('publishes accumulated deltas and opens audio before the candidate or first chunk', async () => {
    const input = makeInput();
    const { requestId } = input;
    const h = transport(), onDelta = vi.fn();
    const turn = requestVoiceTurn(h.fetcher, input, new AbortController().signal, { sentenceStream: true, onDelta });
    const first = '可以慢慢说。', second = '我们先看这一段。', final = '我在听。';
    let checked = false;
    void turn.candidate.then(() => { checked = true; });
    h.send({ type: 'delta', requestId, text: first });
    h.send(audioStart(requestId));
    const speech = await turn.audio;
    expect(speech).toBeInstanceOf(Mp3Speech);
    expect(turn.earlyAudio).toBe(true);
    expect(checked).toBe(false);
    expect(onDelta).toHaveBeenCalledExactlyOnceWith(first);
    const iterator = (speech as Mp3Speech)[Symbol.asyncIterator]();
    h.send(chunk(requestId));
    h.send({ type: 'delta', requestId, text: second });
    expect((await iterator.next()).value).toEqual(new Uint8Array([73, 68, 51, 0]));
    const candidate = { ...mockCandidate(input), assistantText: first + second + final };
    h.send({ type: 'candidate', candidate });
    expect(await turn.candidate).toEqual(candidate);
    expect(onDelta.mock.calls).toEqual([[first], [first + second]]);
    h.send({ type: 'delta', requestId, text: final });
    h.send(chunk(requestId, 1));
    h.send({ type: 'done', requestId });
    await turn.audioDone;
    expect(onDelta).toHaveBeenCalledTimes(2);
    expect((await iterator.next()).done).toBe(false);
    expect((await iterator.next()).done).toBe(true);
  });

  it.each(['invalid version', 'changed caption', 'agent error', 'wrong delta id'])('fails already open audio and cancels the body on %s', async kind => {
    const input = makeInput(), { requestId } = input;
    const h = transport(), turn = requestVoiceTurn(h.fetcher, input, new AbortController().signal, { sentenceStream: true });
    const assistantText = '可以慢慢说。';
    h.send({ type: 'delta', requestId, text: assistantText });
    h.send(audioStart(requestId));
    h.send(chunk(requestId));
    const iterator = (await turn.audio as Mp3Speech)[Symbol.asyncIterator]();
    await iterator.next();
    const next = iterator.next();
    const candidate = { ...mockCandidate(input), assistantText };
    if (kind === 'agent error') h.send(error(requestId, 'agent'));
    else if (kind === 'wrong delta id') h.send({ type: 'delta', requestId: 'a different request', text: '还在听。' });
    else h.send({ type: 'candidate', candidate: { ...candidate, ...(kind === 'invalid version' ? { epoch: input.epoch + 1 } : { assistantText: '已改了开头。' }) } });
    await expect(turn.candidate).rejects.toThrow();
    await expect(turn.audioDone).rejects.toThrow();
    await expect(next).rejects.toThrow();
    expect(h.canceled).toHaveBeenCalledOnce();
    expect(turn.preview).toBe('');
  });

  it.each(['before audio', 'during early audio', 'after candidate'])('preserves checked text when synthesis fails %s', async when => {
    const input = makeInput('interview'), { requestId } = input;
    const h = transport(), turn = requestVoiceTurn(h.fetcher, input, new AbortController().signal, { sentenceStream: true });
    const candidate = mockCandidate(input);
    let iterator: AsyncIterator<Uint8Array> | undefined;
    if (when === 'during early audio') {
      h.send(audioStart(requestId));
      h.send(chunk(requestId));
      iterator = (await turn.audio as Mp3Speech)[Symbol.asyncIterator]();
      await iterator.next();
    } else if (when === 'after candidate') {
      h.send({ type: 'candidate', candidate });
      expect(await turn.candidate).toEqual(candidate);
    }
    h.send(error(requestId, 'synthesize'));
    await expect(turn.audioDone).rejects.toThrow('声音暂时没接上');
    if (iterator) await expect(iterator.next()).rejects.toThrow('声音暂时没接上');
    else await expect(turn.audio).rejects.toThrow('声音暂时没接上');
    if (when !== 'after candidate') {
      expect(h.canceled).not.toHaveBeenCalled();
      h.send({ type: 'candidate', candidate });
    }
    expect(await turn.candidate).toEqual(candidate);
    expect(h.canceled).toHaveBeenCalledOnce();
  });

  it('rejects audio before the checked debrief even when sentence streaming is enabled', async () => {
    const input = makeInput('interview'), h = transport();
    input.context.interview!.stage = 'debrief';
    const turn = requestVoiceTurn(h.fetcher, input, new AbortController().signal, { sentenceStream: true });
    h.send(audioStart(input.requestId));
    await expect(turn.audio).rejects.toThrow('声音连接中断');
    await expect(turn.candidate).rejects.toThrow('声音连接中断');
  });
});
