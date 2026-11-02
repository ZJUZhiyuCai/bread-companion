import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { synthesizeStream } from '@/server/providers/speech-stream';
import { requestVoiceTurn, canStreamPcm, canStreamMp3 } from '@/services/voice-turn';
import { PcmSpeech, Mp3Speech } from '@/services/speech-stream';
import { BrowserCallAudio } from '@/services/call-audio';
import { PlaybackEchoGuard } from '@/services/playback-echo';
import { VoiceActivity } from '@/services/voice-activity';
import { readFileSync } from 'node:fs';
import { MPEGDecoder } from 'mpg123-decoder';
import * as decoderFactory from '@/services/speech-decoder';
import { requestFixture } from '@/fixtures/scenarios';
import { mockCandidate } from '@/server/providers/mock-agent';
const encode = (s: string) => new TextEncoder().encode(s);
const input = requestFixture({ mode: 'listen', channel: 'call' });
const candidate = { type: 'candidate', candidate: mockCandidate(input) };
const begin = { type: 'audio_start', requestId: input.requestId, format: 'pcm-s16le', sampleRate: 32000, channels: 1 };
const chunk = { type: 'audio_chunk', requestId: input.requestId, sequence: 0, audio: 'AAD/fw==' };
const done = { type: 'done', requestId: input.requestId };
function transport() {
  let writer!: ReadableStreamDefaultController<Uint8Array>; const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({ start(c) { writer = c; }, cancel });
  const fetcher = vi.fn(async () => new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } }));
  return { fetcher, cancel, send(event: unknown) { writer.enqueue(encode(JSON.stringify(event) + '\n')); }, close() { writer.close(); } };
}
beforeEach(() => { vi.stubEnv('TTS_PROVIDER', 'minimax'); vi.stubEnv('MINIMAX_API_KEY', 'fixture'); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('streaming provider validates framing and completion', () => {
  const event = (status: number, audio = '') => ({ data: { status, audio }, base_resp: { status_code: 0 }, ...(status === 2 ? { extra_info: { audio_format: 'pcm', audio_sample_rate: 32000, audio_channel: 1 } } : {}) });
  const sse = (e: unknown) => `data: ${JSON.stringify(e)}\r\n\r\n`;
  it('yields the first PCM before completion without replaying aggregated audio', async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({ start(c) { writer = c; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const iterator = synthesizeStream('这份落差确实不好受。', new AbortController().signal, fetcher);
    const first = iterator.next(); await vi.waitFor(() => expect(writer).toBeDefined());
    // Real SSE records may split anywhere, including CRLF and UTF-8 boundaries.
    for (const byte of encode(sse(event(1, '0000ff7f')))) writer.enqueue(new Uint8Array([byte]));
    expect((await first).value).toEqual(new Uint8Array([0, 0, 255, 127]));
    const next = iterator.next(); writer.enqueue(encode(sse(event(2)))); writer.close();
    expect((await next).done).toBe(true);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.stream_options.exclude_aggregated_audio).toBe(true); expect(body.model).toBe('speech-2.8-hd');
  });
  it('rejects malformed samples, truncated output, provider errors and incompatible metadata', async () => {
    for (const events of [[event(1, '000')], [event(1, '0000')], [{ ...event(1), base_resp: { status_code: 1002 } }], [event(1, '0000'), { ...event(2), extra_info: { audio_format: 'mp3' } }]]) {
      const fetcher = vi.fn(async () => new Response(events.map(sse).join(''), { headers: { 'Content-Type': 'text/event-stream' } }));
      const read = async () => { for await (const _ of synthesizeStream('好。', new AbortController().signal, fetcher)) { /* drain */ } };
      await expect(read()).rejects.toThrow(); expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('cancels a stalled body immediately when interrupted', async () => {
    const cancel = vi.fn(), abort = new AbortController();
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const pending = synthesizeStream('好。', abort.signal, fetcher).next();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled()); abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('browser stream protocol', () => {
  it('chooses MP3 for known slow links or data saving before any paid generation', async () => {
    for (const connection of [{ saveData: true }, { effectiveType: 'slow-2g' }, { effectiveType: '2g' }, { effectiveType: '3g' }, { downlink: .8 }]) expect(canStreamPcm(connection)).toBe(false);
    expect(canStreamPcm({ effectiveType: '4g', downlink: 2 })).toBe(true); expect(canStreamPcm()).toBe(true);
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    try {
      const h = transport(), turn = requestVoiceTurn(h.fetcher, input, new AbortController().signal);
      h.send(candidate); h.send({ type: 'audio', requestId: input.requestId, mime: 'audio/mpeg', audio: 'SUQzAA==' }); h.send(done); h.close();
      expect(await turn.audio).toBeInstanceOf(Blob);
      expect(new Headers((h.fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).has('X-Bread-Audio')).toBe(false);
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
  it('plays validated chunks before done but does not accept EOF as successful completion', async () => {
    const h = transport(), turn = requestVoiceTurn(h.fetcher, input, new AbortController().signal);
    h.send(candidate); h.send(begin); h.send(chunk);
    expect(await turn.candidate).toEqual(mockCandidate(input));
    const pcm = await turn.audio; expect(pcm).toBeInstanceOf(PcmSpeech);
    const iterator = (pcm as PcmSpeech)[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toEqual(new Uint8Array([0, 0, 255, 127]));
    h.close(); await expect(iterator.next()).rejects.toThrow('声音连接中断');
  });
  it('accepts a complete stream and rejects duplicates, wrong IDs, rates and oversized queues', async () => {
    const h = transport(), turn = requestVoiceTurn(h.fetcher, input, new AbortController().signal);
    [candidate, begin, chunk, done].forEach(h.send); h.close();
    const sizes: number[] = []; for await (const c of await turn.audio as PcmSpeech) sizes.push(c.length);
    expect(sizes).toEqual([4]);
    for (const broken of [[candidate, { ...begin, sampleRate: 16000 }], [candidate, begin, { ...chunk, requestId: 'other' }], [candidate, begin, chunk, chunk], [candidate, begin, done]]) {
      const f = transport(), t = requestVoiceTurn(f.fetcher, input, new AbortController().signal); broken.forEach(f.send); f.close();
      const drain = async () => { for await (const _ of await t.audio as PcmSpeech) { /* drain */ } };
      await expect(drain()).rejects.toThrow();
    }
    const queue = new PcmSpeech(); queue.push(new Uint8Array(4 * 1024 * 1024)); expect(() => queue.push(new Uint8Array(2))).toThrow();
  });
  it('propagates hangup after the first playable chunk and cancels transport', async () => {
    const h = transport(), abort = new AbortController(), turn = requestVoiceTurn(h.fetcher, input, abort.signal);
    [candidate, begin, chunk].forEach(h.send); const pcm = await turn.audio as PcmSpeech;
    const iterator = pcm[Symbol.asyncIterator](); await iterator.next(); abort.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' }); expect(h.cancel).toHaveBeenCalledTimes(1);
  });
});

function player() {
  const nodes: { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended: (() => void) | null; buffer: AudioBuffer | null }[] = [];
  const context = { currentTime: 10, sampleRate: 48000, state: 'running', destination: {},
    createBuffer: (_channels: number, length: number, sampleRate: number) => { const pcm = new Float32Array(length); return { duration: length / sampleRate, sampleRate, getChannelData: () => pcm }; },
    createBufferSource: () => { const source = { start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), onended: null, buffer: null }; nodes.push(source); return source; },
  };
  const audio = new BrowserCallAudio(); Object.assign(audio, { context });
  return { audio, context, nodes };
}
describe('PCM playback and endpointing', () => {
  it('schedules continuous audio, starts early, and waits for the actual final sample', async () => {
    const h = player(), pcm = new PcmSpeech(), start = vi.fn();
    const played = h.audio.play(pcm, new AbortController().signal, start);
    pcm.push(new Uint8Array(32000)); await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(h.nodes[0].start).toHaveBeenCalledWith(10.06);
    pcm.push(new Uint8Array(16000)); pcm.end();
    await vi.waitFor(() => expect(h.nodes).toHaveLength(2));
    expect(h.nodes[1].start.mock.calls[0][0]).toBeCloseTo(10.56);
    let finished = false; void played.then(() => { finished = true; }); await Promise.resolve(); expect(finished).toBe(false);
    h.nodes.forEach(s => s.onended?.()); await played; expect(start).toHaveBeenCalledTimes(1);
  });
  it.each(['abort', 'failure'])('stops every queued source on %s, including audio scheduled in the future', async kind => {
    const h = player(), pcm = new PcmSpeech(), abort = new AbortController();
    const played = h.audio.play(pcm, abort.signal, () => {}); const rejected = expect(played).rejects.toThrow();
    pcm.push(new Uint8Array(32000)); pcm.push(new Uint8Array(16000)); await vi.waitFor(() => expect(h.nodes).toHaveLength(2));
    if (kind === 'abort') abort.abort(); else pcm.fail(new Error('truncated'));
    await rejected; h.nodes.forEach(s => expect(s.stop).toHaveBeenCalledTimes(1));
  });
  it('retains echo suppression across a PCM chunk boundary and admits near-end speech', () => {
    const rate = 48000, pcm = Float32Array.from({ length: rate }, (_, i) => .07 * Math.sin(i * 2 * Math.PI * 213 / rate) + .03 * Math.sin(i * 2 * Math.PI * 573 / rate));
    const guard = new PlaybackEchoGuard(); guard.attach(pcm.slice(0, 24000), rate, 10); guard.append(pcm.slice(24000), rate, 10.5);
    const frame = pcm.slice(23500, 24524).map(x => x * .6), at = 10 + 23500 / rate + .063;
    expect(guard.isEcho(frame, at)).toBe(true);
    expect(guard.isEcho(frame.map((x, i) => x + .06 * Math.sin(i * 2 * Math.PI * 391 / rate)), at)).toBe(false);
  });
  it('allows a half-second thinking pause and retains both sides of the sentence', () => {
    const vad = new VoiceActivity(16000); const voice = new Float32Array(320).fill(.1), silence = new Float32Array(320);
    for (let i = 0; i < 20; i++) expect(vad.push(voice).utterance).toBeNull();
    for (let i = 0; i < 25; i++) expect(vad.push(silence).utterance).toBeNull();
    for (let i = 0; i < 20; i++) expect(vad.push(voice).utterance).toBeNull();
    let result: Float32Array | null = null;
    for (let i = 0; i < 33; i++) result ||= vad.push(silence).utterance;
    expect(result).not.toBeNull(); expect(result!.length / 16000).toBeCloseTo(1.5, 1);
  });
});


describe('compressed streaming avoids the PCM bandwidth penalty', () => {
  it('uses compressed streaming on ordinary 3G while protecting save-data and very slow connections', () => {
    expect(canStreamMp3({ effectiveType: '3g', downlink: 1.25 })).toBe(true);
    expect(canStreamMp3({ effectiveType: '3g', downlink: .5 })).toBe(true);
    for (const c of [{ saveData: true }, { effectiveType: '2g' }, { downlink: .2 }]) expect(canStreamMp3(c)).toBe(false);
  });
  const mp3 = new Uint8Array(readFileSync('public/companion/hello-warm-bestie.mp3'));
  it('decodes arbitrary MP3 byte boundaries identically to the complete file', async () => {
    const whole = new MPEGDecoder(), incremental = new MPEGDecoder();
    await Promise.all([whole.ready, incremental.ready]);
    try {
      const reference = whole.decode(mp3), parts: Float32Array[] = []; let count = 0, firstAt = 0;
      for (let i = 0; i < mp3.length; i += 997) {
        const decoded = incremental.decode(mp3.subarray(i, i + 997)); expect(decoded.errors).toEqual([]);
        if (decoded.samplesDecoded) { parts.push(decoded.channelData[0]); count += decoded.samplesDecoded; firstAt ||= i + 997; }
      }
      const joined = new Float32Array(count); let offset = 0;
      for (const part of parts) { joined.set(part, offset); offset += part.length; }
      expect(firstAt).toBeLessThan(mp3.length / 4); expect(joined).toEqual(reference.channelData[0]);
      expect(reference.sampleRate).toBe(32000);
    } finally { whole.free(); incremental.free(); }
  });
  it('starts actual MP3 playback before all bytes arrive and frees future sources on interruption', async () => {
    const h = player(), stream = new Mp3Speech(), abort = new AbortController(), start = vi.fn();
    const played = h.audio.play(stream, abort.signal, start); const rejected = expect(played).rejects.toThrow();
    stream.push(mp3.slice(0, 8192)); await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    stream.push(mp3.slice(8192)); await vi.waitFor(() => expect(h.nodes.length).toBeGreaterThan(1));
    abort.abort(); await rejected; h.nodes.forEach(s => expect(s.stop).toHaveBeenCalledTimes(1));
  });
  it('uses native decoding of the same response if the optional decoder cannot initialize', async () => {
    vi.spyOn(decoderFactory, 'createSpeechDecoder').mockResolvedValue(null);
    const h = player(), stream = new Mp3Speech(), start = vi.fn();
    const decode = vi.fn(async (_bytes: ArrayBuffer) => h.context.createBuffer(1, 32000, 32000));
    Object.assign(h.context, { decodeAudioData: decode });
    const played = h.audio.play(stream, new AbortController().signal, start);
    stream.push(mp3.slice(0, 8192)); await Promise.resolve(); expect(start).not.toHaveBeenCalled();
    stream.push(mp3.slice(8192)); stream.end();
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1)); expect(decode).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(decode.mock.calls[0][0] as ArrayBuffer)).toEqual(mp3);
    h.nodes[0].onended?.(); await played;
  });
  it.each(['reported', 'measured'])('buffers a short first fragment on a %s slow link and schedules the delayed next fragment without a gap', async hint => {
    vi.stubGlobal('navigator', { connection: hint === 'reported' ? { effectiveType: '3g', rtt: 400, downlink: 1.25 } : { effectiveType: '4g', rtt: 50, downlink: 10 } });
    try {
      const h = player(), stream = new Mp3Speech(), abort = new AbortController(), start = vi.fn();
      if (hint === 'measured') h.audio.observeNetworkDelay(650);
      const decoder = new MPEGDecoder(); await decoder.ready;
      const decode = vi.spyOn(decoder, 'decode'); vi.spyOn(decoderFactory, 'createSpeechDecoder').mockResolvedValue(decoder);
      const played = h.audio.play(stream, abort.signal, start); const rejected = expect(played).rejects.toThrow();
      stream.push(mp3.slice(0, 4096)); await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
      expect(start).not.toHaveBeenCalled(); expect(h.nodes).toHaveLength(0);
      h.context.currentTime = 11.5; stream.push(mp3.slice(4096, 16384));
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1)); expect(h.nodes).toHaveLength(2);
      const firstAt = h.nodes[0].start.mock.calls[0][0];
      expect(firstAt).toBeCloseTo(11.56);
      expect(h.nodes[1].start.mock.calls[0][0]).toBeCloseTo(firstAt + h.nodes[0].buffer!.duration);
      abort.abort(); await rejected; h.nodes.forEach(node => expect(node.stop).toHaveBeenCalledTimes(1));
    } finally { vi.unstubAllGlobals(); }
  });
  it.each(['complete', 'interrupt'])('does not strand a short buffered utterance when it must %s', async mode => {
    vi.stubGlobal('navigator', { connection: { effectiveType: '3g', rtt: 400 } });
    try {
      const h = player(), stream = new Mp3Speech(), abort = new AbortController(), start = vi.fn();
      const decoder = new MPEGDecoder(); await decoder.ready;
      const decode = vi.spyOn(decoder, 'decode'); vi.spyOn(decoderFactory, 'createSpeechDecoder').mockResolvedValue(decoder);
      const played = h.audio.play(stream, abort.signal, start); void played.catch(() => {});
      stream.push(mp3.slice(0, 4096)); await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
      expect(start).not.toHaveBeenCalled();
      if (mode === 'interrupt') { abort.abort(); await expect(played).rejects.toThrow(); expect(h.nodes).toHaveLength(0); }
      else { stream.end(); await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1)); h.nodes[0].onended?.(); await played; }
    } finally { vi.unstubAllGlobals(); }
  });
  it('rejects an empty decoded stream rather than claiming a successful silent reply', async () => {
    const h = player(), stream = new Mp3Speech(), start = vi.fn();
    const played = h.audio.play(stream, new AbortController().signal, start);
    stream.push(new Uint8Array([0, 1, 2])); stream.end();
    await expect(played).rejects.toThrow('声音数据'); expect(start).not.toHaveBeenCalled();
  });
});
