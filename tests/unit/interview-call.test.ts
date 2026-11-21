import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CALL_GREETING } from '@/domain/call-greeting';
import { callSeedSchema, completeCallSeed, type CallSeed } from '@/domain/call-pipeline';
import { locateEvidence } from '@/domain/evidence';
import type { CallTurnProfile, Capabilities, TurnCandidate, TurnRequest } from '@/domain/types';
import { mockCandidate } from '@/server/providers/mock-agent';
import { BreadController } from '@/services/bread-controller';
import type { CallAudioEvents, CallAudioPort } from '@/services/call-audio';
import { SpeechChunks, type CallSpeech } from '@/services/speech-stream';

const file = new File(['synthetic speech'], 'turn.wav', { type: 'audio/wav' });
const answer1 = '我先看了性能监控，再对比了开启缓存和关闭缓存的耗时。';
const answer2 = '我做了三组对照，每组有十个样例，人工检查了页面首次加载的日志。';
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
};
const controllers: BreadController[] = [];
afterEach(() => controllers.splice(0).forEach(controller => controller.dispose()));

class AudioFake implements CallAudioPort {
  events!: CallAudioEvents;
  profile: CallTurnProfile = 'chat';
  profilesAtOpen: CallTurnProfile[] = [];
  open = vi.fn(async (events: CallAudioEvents) => {
    this.events = events;
    this.profilesAtOpen.push(this.profile);
    return true;
  });
  setProfile = vi.fn((profile: CallTurnProfile) => { this.profile = profile; });
  listen = vi.fn();
  close = vi.fn();
  finish = vi.fn();
  stopPlayback = vi.fn();
  play = vi.fn(async (speech: CallSpeech, signal: AbortSignal, start: () => void, _startWithFirstChunk?: boolean) => {
    if (!(speech instanceof SpeechChunks)) { start(); return; }
    let started = false;
    for await (const chunk of speech) {
      signal.throwIfAborted();
      if (chunk.length && !started) { started = true; start(); }
    }
  });
}

function voiceExchange(init: RequestInit, input: TurnRequest | null, seed?: CallSeed) {
  const canceled = vi.fn();
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { writer = c; }, cancel: canceled });
  const requestId = input?.requestId ?? seed!.requestId;
  const send = (...events: unknown[]) => {
    if (!canceled.mock.calls.length) writer.enqueue(new TextEncoder().encode(events.map(event => JSON.stringify(event) + '\n').join('')));
  };
  const finish = () => {
    send({ type: 'candidate', candidate: mockCandidate(input!) },
      { type: 'audio_start', requestId, format: 'mp3', sampleRate: 32000, channels: 1 },
      { type: 'audio_chunk', requestId, sequence: 0, audio: 'SUQzAA==' },
      { type: 'done', requestId });
    writer.close();
  };
  const firstSentence = (text: string) => send(
    { type: 'delta', requestId, text },
    { type: 'audio_start', requestId, format: 'mp3', sampleRate: 32000, channels: 1 },
    { type: 'audio_chunk', requestId, sequence: 0, audio: 'SUQzAA==' },
  );
  return { input, seed, signal: init.signal!, headers: new Headers(init.headers), canceled, requestId, send, finish, firstSentence,
    response: new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }), close: () => writer.close() };
}

async function setup({ merged = true, hold = false, beforeTranscript, failDebrief = false }: {
  merged?: boolean; hold?: boolean; beforeTranscript?: Promise<void>; failDebrief?: boolean;
} = {}) {
  const audio = new AudioFake();
  const caps: Capabilities = {
    agent: { mode: 'mock', label: 'test agent', configured: true },
    asr: { available: true, label: 'test ASR', callPipeline: merged },
    tts: { available: true, label: 'test TTS', turnStream: true, sentenceStream: true, greeting: CALL_GREETING.url },
    limits: { maxInputChars: 4000, maxSourceChars: 20000, maxAudioBytes: 4000044, maxRecordingSeconds: 60 },
    processingNotice: 'Test data',
  };
  const voices: ReturnType<typeof voiceExchange>[] = [], turns: TurnRequest[] = [];
  const uploads: { profile: FormDataEntryValue | null; file: File }[] = [];
  const transcripts: string[] = [], syntheses: string[] = [];
  const nextTranscript = () => {
    const text = transcripts.shift();
    if (text === undefined) throw new Error('No fixture transcript was queued');
    return text;
  };
  const debriefFailure = (input: TurnRequest | null) => {
    if (!failDebrief || input?.context.interview?.stage !== 'debrief') return;
    failDebrief = false;
    return Response.json({ error: { code: 'PROVIDER_UNAVAILABLE', userMessage: '暂时没接上。', retryable: true, requestId: input.requestId, stage: 'agent' } }, { status: 502 });
  };
  const fetcher: typeof fetch = async (url, init) => {
    if (url === '/api/capabilities') return Response.json(caps);
    if (url === '/api/agent/turn') {
      const input: TurnRequest = JSON.parse(String(init?.body));
      turns.push(input);
      return debriefFailure(input) ?? Response.json(mockCandidate(input));
    }
    if (url === '/api/speech/synthesize') {
      syntheses.push(JSON.parse(String(init?.body)).text);
      return new Response('synthetic audio', { headers: { 'Content-Type': 'audio/mpeg' } });
    }
    if (url === '/api/speech/transcribe') {
      const form = init?.body as FormData;
      uploads.push({ profile: form.get('profile'), file: form.get('file') as File });
      await beforeTranscript;
      return Response.json({ requestId: form.get('requestId'), text: nextTranscript() });
    }
    if (url === '/api/agent/voice') {
      const form = init?.body instanceof FormData ? init.body : null;
      const seed = form ? callSeedSchema.parse(JSON.parse(String(form.get('seed')))) : undefined;
      const text = seed ? nextTranscript() : undefined;
      const input: TurnRequest | null = seed ? completeCallSeed(seed, text!) : JSON.parse(String(init?.body));
      const exchange = voiceExchange(init!, input, seed);
      voices.push(exchange);
      const failure = debriefFailure(input);
      if (failure) { exchange.close(); return failure; }
      if (seed) {
        await beforeTranscript;
        exchange.send({ type: 'transcript', requestId: seed.requestId, text });
      }
      if (!input) { exchange.send({ type: 'transcript_done', requestId: seed!.requestId }); exchange.close(); }
      else if (!hold) exchange.finish();
      return exchange.response;
    }
    throw new Error('Unexpected request ' + url);
  };
  const c = new BreadController(fetcher, undefined, audio);
  controllers.push(c);
  await c.initialize();
  const view = c.getSnapshot;
  const utter = (text: string, audioFile = file) => { transcripts.push(text); audio.events.utterance(audioFile); };
  const say = async (text: string, audioFile = file) => {
    utter(text, audioFile);
    await vi.waitFor(() => expect(view().call).toMatchObject({ lastHeard: text, phase: 'listening' }));
  };
  return { c, view, audio, voices, turns, uploads, syntheses, utter, say };
}

describe('interview actions on the live call', () => {
  it('opens Round 1 in a listening call, uses CallSeed for answers, and reads a grounded debrief on the same microphone', async () => {
    const h = await setup();
    h.c.addMaterial('前端岗位要求。关注页面性能、缓存和可观测性。');
    await h.view().startCall();
    h.audio.play.mockClear();
    await h.view().startInterview({ role: '前端工程师', topic: '性能', maxRounds: 6 });
    expect(h.view().state.interview).toMatchObject({ style: 'gentle', role: '前端工程师', topic: '性能', round: 1, stage: 'question' });
    expect(h.view().call.caption).toContain(h.view().state.interview!.currentQuestion);
    expect(h.voices[0].seed).toBeUndefined();
    expect(h.voices[0].headers.get('X-Bread-Voice-Stream')).toBe('sentence-v1');
    expect(h.audio.profile).toBe('interview');

    await h.say(answer1);
    await h.say(answer2);
    expect(h.voices.slice(1, 3).map(voice => voice.seed?.mode)).toEqual(['interview', 'interview']);
    expect(h.voices.slice(1, 3).map(voice => voice.seed?.interview?.round)).toEqual([1, 2]);
    expect(h.voices[1].seed?.sources.some(source => source.label.startsWith('粘贴的材料'))).toBe(true);
    expect(h.voices[1].headers.get('X-Bread-Voice-Stream')).toBe('sentence-v1');
    expect(h.view().state.interview).toMatchObject({ round: 3, stage: 'follow_up' });
    const beforeStyle = h.view().state.interview!;
    await h.say('严格一点');
    expect(h.voices[3].input).toBeNull();
    expect(h.voices).toHaveLength(4);
    expect(h.view().state.interview).toEqual({ ...beforeStyle, style: 'realistic' });
    expect(h.view().call.caption).toBe('好，接下来我换真实深挖的方式问你，这题你接着答就好。');
    expect(h.view().state.sources.find(source => source.text === '严格一点')?.label).toBe('本次请求');

    await h.view().requestInterviewDebrief();
    const debrief = h.voices[4];
    expect(debrief.seed).toBeUndefined();
    expect(debrief.input).toMatchObject({ mode: 'interview', channel: 'call', context: { interview: { stage: 'debrief' } } });
    expect(debrief.headers.get('X-Bread-Voice-Stream')).toBeNull();
    expect(debrief.headers.get('X-Bread-Audio')).toBe('mp3-chunks-v1');
    expect(debrief.input?.context.sourceSegments?.map(segment => segment.text)).toEqual(expect.arrayContaining([answer1, answer2]));
    expect(debrief.input?.context.sourceSegments?.map(segment => segment.label)).not.toContain('本次请求');
    const { call, currentCard, state } = h.view();
    expect(call.caption).toBe(state.messages.at(-1)?.text);
    expect(call.caption).toContain('辛苦了');
    expect(currentCard).toMatchObject({ type: 'review', validity: 'draft' });
    const refs = state.findings.flatMap(finding => finding.evidenceRefs);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every(ref => locateEvidence(state.sources, ref, true))).toBe(true);
    expect(h.audio.play).toHaveBeenCalledTimes(5);
    expect(h.audio.play.mock.lastCall?.[3]).toBeUndefined();
    expect(h.turns).toEqual([]);
    expect(h.uploads).toEqual([]);
    expect(h.syntheses).toEqual(['好，接下来我换真实深挖的方式问你，这题你接着答就好。']);

    h.view().exitInterviewToListen();
    expect(h.view().state.interview).toBeNull();
    expect(h.view().state.mode).toBe('listen');
    expect(h.view().call).toMatchObject({ active: true, phase: 'listening', caption: '', captionPreview: false, lastHeard: '' });
    expect(h.audio.setProfile.mock.calls).toEqual([['interview'], ['chat']]);
    expect(h.audio.open).toHaveBeenCalledOnce();
    expect(h.audio.close).not.toHaveBeenCalled();
  });

  it('routes voice start, debrief and exit commands without hanging up', async () => {
    const h = await setup();
    await h.c.startCall();
    await h.say('开始模拟面试');
    expect(h.view().state.interview?.round).toBe(1);
    expect(h.voices[0].input).toBeNull();
    expect(h.voices[1].input?.mode).toBe('interview');
    await h.say(answer1);
    await h.say('结束模拟面试');
    expect(h.voices[3].input).toBeNull();
    expect(h.voices[4].input?.context.interview?.stage).toBe('debrief');
    expect(h.voices[4].headers.get('X-Bread-Voice-Stream')).toBeNull();
    expect(h.view().currentCard?.type).toBe('review');
    expect(h.view().state.sources.find(source => source.text === '结束模拟面试')?.label).toBe('本次请求');
    await h.say('回到聊天');
    expect(h.uploads.map(upload => upload.profile)).toEqual(['interview']);
    expect(h.voices[5].input?.mode).toBe('listen');
    expect(h.view().state.interview).toBeNull();
    expect(h.view().call.caption).toBe(h.view().state.messages.at(-1)?.text);
    expect(h.audio.profile).toBe('chat');
    expect(h.audio.open).toHaveBeenCalledOnce();
    expect(h.audio.close).not.toHaveBeenCalled();
  });

  it('keeps the last question open on a style command, then sends the answer via checked JSON voice', async () => {
    const h = await setup();
    await h.c.startInterview({ startCall: true, maxRounds: 1 });
    const question = h.view().state.interview!.currentQuestion;
    await h.say('严格一点');
    expect(h.view().state.interview).toMatchObject({ currentQuestion: question, round: 1, stage: 'question', style: 'realistic' });
    expect(h.voices).toHaveLength(1);
    expect(h.view().state.interview?.answerSourceIds).toEqual([]);
    expect(h.syntheses).toHaveLength(1);
    await h.say(answer1);
    expect(h.uploads.map(upload => upload.profile)).toEqual(['interview', 'interview']);
    expect(h.voices[1].seed).toBeUndefined();
    expect(h.voices[1].input?.userMessage).toBe(answer1);
    expect(h.voices[1].headers.get('X-Bread-Voice-Stream')).toBeNull();
    expect(h.view().state.interview?.stage).toBe('debrief');
    expect(h.view().currentCard?.type).toBe('review');
  });

  it('keeps a pending transcript when the style changes and replaces only its old speculative reply', async () => {
    const ready = deferred<void>(), h = await setup({ beforeTranscript: ready.promise });
    await h.view().startInterview({ startCall: true });
    h.utter(answer1);
    await vi.waitFor(() => expect(h.voices).toHaveLength(2));
    const original = h.voices[1];
    expect(original.seed?.interview?.style).toBe('gentle');
    expect(h.view().call.phase).toBe('transcribing');
    h.view().setInterviewStyle('realistic');
    expect(original.signal.aborted).toBe(false);
    expect(h.view().call.phase).toBe('transcribing');
    ready.resolve();
    await vi.waitFor(() => expect(h.view().call).toMatchObject({ phase: 'listening', lastHeard: answer1 }));
    expect(original.signal.aborted).toBe(true);
    expect(h.voices).toHaveLength(3);
    expect(h.voices[2].seed).toBeUndefined();
    expect(h.voices[2].input).toMatchObject({ userMessage: answer1, context: { interview: { style: 'realistic', round: 1 } } });
    const { interview, messages } = h.view().state;
    expect(interview).toMatchObject({ style: 'realistic', round: 2, currentQuestion: expect.stringContaining('指标') });
    expect(interview?.answerSourceIds).toEqual([messages.find(m => m.text === answer1)?.sourceId]);
    expect(messages.filter(m => m.text === answer1)).toHaveLength(1);
    expect(h.uploads).toEqual([]);
  });

  it('acknowledges a typed style command locally and uses the new style on the actual answer', async () => {
    const h = await setup();
    await h.view().startInterview();
    const beforeStyle = h.view().state.interview!;
    await h.c.send('严格一点');
    expect(h.turns).toHaveLength(1);
    expect(h.view().state.interview).toEqual({ ...beforeStyle, style: 'realistic' });
    expect(h.view().state.sources.at(-1)).toMatchObject({ label: '本次请求', text: '严格一点' });
    expect(h.view().state.messages.at(-1)).toMatchObject({ role: 'assistant', text: expect.stringContaining('这题你接着答') });
    await h.c.send(answer1);
    expect(h.turns[1].context.interview).toMatchObject({ style: 'realistic', round: 1 });
    expect(h.view().state.interview?.round).toBe(2);
  });

  it.each([true, false])('retries a failed manual debrief with the same evidence (live call %s)', async inCall => {
    const h = await setup({ failDebrief: true });
    await h.view().startInterview({ startCall: inCall });
    if (inCall) await h.say(answer1);
    else await h.c.send(answer1);
    const answers = h.view().state.interview?.answerSourceIds;
    await h.view().requestInterviewDebrief();
    expect(h.view().state.interview).toMatchObject({ round: 2, stage: 'debrief', answerSourceIds: answers });
    expect(h.view().currentCard).toBeNull();
    const failed = inCall ? h.voices.at(-1)?.input : h.turns.at(-1);
    expect(failed?.context.sourceSegments?.map(s => s.text)).toEqual([answer1]);
    await h.view().requestInterviewDebrief();
    const retried = inCall ? h.voices.at(-1)?.input : h.turns.at(-1);
    expect(retried?.requestId).not.toBe(failed?.requestId);
    expect(retried?.context.sourceSegments).toEqual(failed?.context.sourceSegments);
    expect(h.view().currentCard).toMatchObject({ type: 'review', validity: 'draft' });
    if (inCall) {
      expect(h.view().call).toMatchObject({ active: true, phase: 'listening', inputWarning: '' });
      expect(h.audio.open).toHaveBeenCalledOnce();
    }
  });

  it('keeps setMode, setPractice and assist in the call, including practice ASR', async () => {
    const h = await setup({ merged: false });
    await h.c.startCall();
    h.view().setMode('interview');
    expect(h.audio.profile).toBe('interview');
    h.view().setPractice('讲一次你排查性能问题的经历。', []);
    expect(h.view().state.selectedQuestion).toBe('讲一次你排查性能问题的经历。');
    await h.view().assist('practice');
    expect(h.turns[0]).toMatchObject({ channel: 'call', mode: 'practice' });
    expect(h.view().state.selectedQuestion).toBeTruthy();
    await h.say(answer1);
    expect(h.uploads[0].profile).toBe('interview');
    h.view().setMode('review');
    expect(h.audio.profile).toBe('chat');
    await h.view().assist('review', '只看具体的动作');
    expect(h.turns.at(-1)).toMatchObject({ mode: 'review', channel: 'call', userMessage: expect.stringContaining('只看具体的动作') });
    expect(h.view().currentCard?.type).toBe('review');
    expect(h.view().call).toMatchObject({ active: true, phase: 'listening' });
    expect(h.audio.open).toHaveBeenCalledOnce();
    expect(h.audio.close).not.toHaveBeenCalled();
  });

  it('uses the extended ASR limit for speech already buffered during an interview', async () => {
    const h = await setup();
    await h.c.startCall();
    h.c.setMode('interview');
    h.c.exitInterviewToListen();
    const buffered = new File([new Uint8Array(44 + 70 * 32000)], 'long.wav', { type: 'audio/wav' });
    await h.say(answer1, buffered);
    expect(h.audio.profile).toBe('chat');
    expect(h.uploads[0]).toEqual({ file: buffered, profile: 'interview' });
    expect(h.voices[0].seed).toBeUndefined();
    expect(h.voices[0].input?.mode).toBe('listen');
  });

  it('opens and debriefs in text when no call was requested', async () => {
    const h = await setup();
    await h.view().startInterview({ style: 'realistic', topic: '缓存', maxRounds: 3 });
    expect(h.view().state.interview).toMatchObject({ style: 'realistic', topic: '缓存', round: 1 });
    const question = h.view().state.interview?.currentQuestion;
    h.view().setInterviewStyle('gentle');
    expect(h.view().state.interview).toMatchObject({ style: 'gentle', round: 1, currentQuestion: question });
    await h.c.send(answer1);
    await h.view().requestInterviewDebrief();
    expect(h.turns.map(turn => [turn.mode, turn.channel])).toEqual([['interview', 'text'], ['interview', 'text'], ['interview', 'text']]);
    expect(h.view().currentCard?.type).toBe('review');
    h.view().exitInterviewToListen();
    expect(h.view().state.mode).toBe('listen');
    expect(h.audio.open).not.toHaveBeenCalled();
    expect(h.voices).toEqual([]);
  });

  it('opens directly in interview profile and asks Round 1 after microphone approval', async () => {
    const h = await setup(), permission = deferred<boolean>();
    h.audio.open.mockImplementationOnce(events => {
      h.audio.events = events;
      h.audio.profilesAtOpen.push(h.audio.profile);
      return permission.promise;
    });
    const opening = h.view().startInterview({ startCall: true, style: 'realistic', role: '后端', maxRounds: 5 });
    expect(h.audio.profilesAtOpen).toEqual(['interview']);
    expect(h.view().call.phase).toBe('connecting');
    expect(h.voices).toHaveLength(0);
    permission.resolve(true);
    await opening;
    expect(h.view().state.interview).toMatchObject({ stage: 'question', round: 1, style: 'realistic', role: '后端', maxRounds: 5 });
    expect(h.view().call.caption).toContain(h.view().state.interview!.currentQuestion);
    expect(h.voices).toHaveLength(1);
    expect(h.audio.play).toHaveBeenCalledOnce();
    expect(h.view().state.messages.some(message => message.text === CALL_GREETING.text)).toBe(false);
    expect(h.syntheses).toEqual([]);
  });

  it.each(['permission denial', 'hangup', 'pause'])('starts no billable request after %s during connect', async reason => {
    const h = await setup(), permission = deferred<boolean>();
    if (reason === 'permission denial') h.audio.open.mockRejectedValueOnce(new DOMException('Microphone denied', 'NotAllowedError'));
    else h.audio.open.mockImplementationOnce(() => permission.promise);
    const opening = h.c.startInterview({ startCall: true });
    if (reason === 'hangup') h.c.hangupCall();
    if (reason === 'pause') h.c.pauseForBackground();
    await opening;
    permission.resolve(true);
    expect(h.view().call.phase).toBe(reason === 'hangup' ? 'idle' : reason === 'pause' ? 'paused' : 'error');
    expect(h.voices).toEqual([]);
    expect(h.turns).toEqual([]);
    expect(h.syntheses).toEqual([]);
    expect(h.view().state.messages).toEqual([]);
    expect(h.audio.play).not.toHaveBeenCalled();
  });

  it.each(['error', 'paused'])('resumes the opening interview after %s and plays the first question', async phase => {
    const h = await setup(), permission = deferred<boolean>();
    if (phase === 'error') h.audio.open.mockRejectedValueOnce(new DOMException('Microphone denied', 'NotAllowedError'));
    else h.audio.open.mockImplementationOnce(() => permission.promise);
    const opening = h.view().startInterview({ startCall: true });
    if (phase === 'paused') h.c.pauseForBackground();
    await opening;
    permission.resolve(true);
    expect(h.view().call.phase).toBe(phase);
    expect(h.view().state.interview?.stage).toBe('opening');
    expect(h.voices).toEqual([]);
    await h.view().resumeCall();
    expect(h.view().state.interview).toMatchObject({ stage: 'question', round: 1 });
    expect(h.view().call).toMatchObject({ phase: 'listening', caption: expect.stringContaining(h.view().state.interview!.currentQuestion) });
    expect(h.audio.open).toHaveBeenCalledTimes(2);
    expect(h.audio.play).toHaveBeenCalledOnce();
    expect(h.voices).toHaveLength(1);
  });

  it('replaces a greeting still waiting for mic permission with Round 1', async () => {
    const h = await setup(), permission = deferred<boolean>();
    h.audio.open.mockImplementationOnce(() => permission.promise);
    const dialing = h.c.startCall();
    const interview = h.c.startInterview();
    expect(h.audio.profile).toBe('interview');
    expect(h.voices).toEqual([]);
    permission.resolve(true);
    await Promise.all([dialing, interview]);
    expect(h.audio.play).toHaveBeenCalledOnce();
    expect(h.voices[0].input?.mode).toBe('interview');
    expect(h.view().state.interview?.round).toBe(1);
    expect(h.audio.open).toHaveBeenCalledOnce();
  });
});

describe('ownership of sentence playback', () => {
  it('plays a merged answer reply while the model is still running and then publishes the checked caption', async () => {
    const h = await setup({ hold: true });
    await h.c.startCall();
    h.c.setMode('interview');
    h.audio.play.mockClear();
    h.utter(answer1);
    await vi.waitFor(() => expect(h.voices).toHaveLength(1));
    const voice = h.voices[0], candidate = mockCandidate(voice.input!);
    const preview = candidate.assistantText.slice(0, -5);
    voice.firstSentence(preview);
    await vi.waitFor(() => expect(h.view().call).toMatchObject({ phase: 'speaking', caption: preview, captionPreview: true }));
    expect(h.audio.play.mock.lastCall?.[3]).toBe(true);
    expect(voice.seed?.mode).toBe('interview');
    expect(h.view().state.messages.at(-1)).toMatchObject({ role: 'user', text: answer1 });
    expect(h.view().state.interview?.round).toBe(0);
    voice.send({ type: 'candidate', candidate });
    await vi.waitFor(() => expect(h.view().call).toMatchObject({ phase: 'speaking', caption: candidate.assistantText, captionPreview: false }));
    expect(h.view().state.messages.at(-1)?.text).toBe(candidate.assistantText);
    voice.send({ type: 'done', requestId: voice.requestId }); voice.close();
    await vi.waitFor(() => expect(h.view().call.phase).toBe('listening'));
    expect(h.audio.play).toHaveBeenCalledOnce();
    expect(h.syntheses).toEqual([]);
  });

  it.each(['barge-in', 'mute', 'pause', 'hangup', 'style change', 'exit'])('aborts a controller-initiated early stream on %s', async action => {
    const h = await setup({ hold: true });
    await h.c.startCall();
    h.audio.play.mockClear();
    const opening = h.view().startInterview();
    const voice = h.voices[0], candidate = mockCandidate(voice.input!);
    voice.firstSentence(candidate.assistantText);
    await vi.waitFor(() => expect(h.view().call.phase).toBe('speaking'));
    expect(h.view().call.captionPreview).toBe(true);
    const beforeStops = h.audio.stopPlayback.mock.calls.length;
    if (action === 'barge-in') h.audio.events.speechStart!();
    if (action === 'mute') h.view().toggleCallMute();
    if (action === 'pause') h.c.pauseForBackground();
    if (action === 'hangup') h.view().hangupCall();
    if (action === 'style change') h.view().setInterviewStyle('realistic');
    if (action === 'exit') h.view().exitInterviewToListen();
    expect(voice.signal.aborted).toBe(true);
    expect(h.audio.play.mock.calls[0][1].aborted).toBe(true);
    expect(h.audio.stopPlayback.mock.calls.length).toBeGreaterThan(beforeStops);
    expect(h.view().call.caption).toBe('');
    await opening;
    expect(voice.canceled).toHaveBeenCalledOnce();
    voice.send({ type: 'candidate', candidate });
    h.audio.play.mock.calls[0][2]();
    const phase = action === 'hangup' ? 'idle' : action === 'pause' ? 'paused' : action === 'mute' ? 'muted' : 'listening';
    expect(h.view().call.phase).toBe(phase);
    expect(h.view().state.messages.some(message => message.text === candidate.assistantText)).toBe(false);
    expect(h.view().state.interview?.round ?? 0).toBe(0);
    if (action === 'style change') expect(h.view().state.interview?.style).toBe('realistic');
    if (['barge-in', 'mute', 'style change', 'exit'].includes(action)) expect(h.audio.close).not.toHaveBeenCalled();
  });

  it.each(['invalid candidate', 'agent error', 'early TTS error', 'TTS quota error'])('stops early playback and recovers the call on %s', async kind => {
    const h = await setup({ hold: true });
    await h.c.startCall();
    const opening = h.c.startInterview();
    const voice = h.voices[0], candidate: TurnCandidate = mockCandidate(voice.input!);
    voice.firstSentence(candidate.assistantText);
    await vi.waitFor(() => expect(h.view().call.phase).toBe('speaking'));
    const synthesisFailed = kind === 'early TTS error' || kind === 'TTS quota error';
    const earlierStops = h.audio.stopPlayback.mock.calls.length;
    if (kind === 'invalid candidate') voice.send({ type: 'candidate', candidate: { ...candidate, epoch: candidate.epoch + 1 } });
    else voice.send({ type: 'error', error: { requestId: voice.requestId, stage: synthesisFailed ? 'synthesize' : 'agent', code: kind === 'TTS quota error' ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', userMessage: '声音暂时没接上。' } });
    if (synthesisFailed) {
      await vi.waitFor(() => expect(h.view().call).toMatchObject({ phase: 'thinking', caption: '', captionPreview: false }));
      expect(h.audio.stopPlayback.mock.calls.length).toBeGreaterThan(earlierStops);
      expect(h.audio.play.mock.lastCall![1].aborted).toBe(true);
      expect(voice.signal.aborted).toBe(false);
      voice.send({ type: 'candidate', candidate });
    }
    await opening;
    expect(h.view().call.phase).toBe('listening');
    expect(h.view().call.captionPreview).toBe(false);
    expect(h.audio.play.mock.lastCall![1].aborted).toBe(true);
    if (synthesisFailed) {
      expect(h.view().call.inputWarning).toBe('这句声音没播完，文字回复还在，可以继续说。');
      expect(h.view().call.caption).toBe(candidate.assistantText);
      expect(h.view().state.messages.at(-1)?.text).toBe(candidate.assistantText);
    } else {
      expect(h.view().call.inputWarning).toContain('回复没接上');
      expect(h.view().call.caption).toBe('');
      expect(h.view().state.messages.at(-1)?.role).toBe('user');
    }
    expect(h.audio.close).not.toHaveBeenCalled();
    expect(h.syntheses).toEqual([]);
  });
});
