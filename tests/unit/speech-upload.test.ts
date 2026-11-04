import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SpeechUpload } from '@/services/speech-upload';
import { encodeWav } from '@/services/media-controller';
import { validateOpus } from '@/server/providers/opus-upload';
import { transcribe } from '@/server/providers/speech';
import { getCapabilities } from '@/server/config';
import { BlobSource, BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedPacketSink, Input, OGG, OggOutputFormat, Output } from 'mediabunny';

const original = () => new File([encodeWav(new Float32Array(16000).fill(.12))], 'speech.wav', { type: 'audio/wav' });
const ogg = () => new File([readFileSync('tests/fixtures/voice-input.opus')], 'speech.ogg', { type: 'audio/ogg' });
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  emit(data: unknown) { this.onmessage?.({ data }); }
}
function setup() {
  vi.stubGlobal('Worker', FakeWorker);
  const worker = new FakeWorker(), upload = new SpeechUpload(() => worker as unknown as Worker);
  upload.warm(); return { worker, upload };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('optional speech upload', () => {
  it('sends WAV immediately when the worker is still loading or unavailable', async () => {
    const { worker, upload } = setup(), file = original(), signal = new AbortController().signal;
    expect(await upload.encode(file, signal)).toBe(file);
    worker.emit({ type: 'unsupported' }); expect(await upload.encode(file, signal)).toBe(file);
    expect(worker.postMessage).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('uses a smaller Ogg file, retaining the untouched source locally', async () => {
    const { worker, upload } = setup(), file = original(); worker.emit({ type: 'ready' });
    const bytes = await file.arrayBuffer(), result = upload.encode(file, new AbortController().signal);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    worker.emit({ id: worker.postMessage.mock.calls[0][0].id, bytes: await ogg().arrayBuffer() });
    expect((await result).type).toBe('audio/ogg'); expect(await file.arrayBuffer()).toEqual(bytes); upload.stop();
  });
  it('bounds encoder stalls, terminates the job and disables repeated waiting for this controller', async () => {
    vi.useFakeTimers(); const { worker, upload } = setup(), file = original(); worker.emit({ type: 'ready' });
    const result = upload.encode(file, new AbortController().signal); await vi.advanceTimersByTimeAsync(300);
    expect(await result).toBe(file); expect(worker.terminate).toHaveBeenCalledOnce();
    expect(await upload.encode(file, new AbortController().signal)).toBe(file); expect(worker.postMessage).toHaveBeenCalledOnce();
  });
  it('hangup cancels encoding; late output cannot resurrect an upload', async () => {
    const { worker, upload } = setup(), file = original(), abort = new AbortController(); worker.emit({ type: 'ready' });
    const result = upload.encode(file, abort.signal), rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce()); abort.abort();
    worker.emit({ id: worker.postMessage.mock.calls[0][0].id, bytes: await ogg().arrayBuffer() });
    await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('keeps WAV when compression is larger or an encoder returns no data', async () => {
    const { worker, upload } = setup(), file = original(); worker.emit({ type: 'ready' });
    const result = upload.encode(file, new AbortController().signal);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    worker.emit({ id: worker.postMessage.mock.calls[0][0].id, bytes: new ArrayBuffer(file.size) });
    expect(await result).toBe(file); upload.stop();
  });
  it('supports a server rollback without changing model or voice configuration', () => {
    vi.stubEnv('ASR_PROVIDER', 'minimax'); vi.stubEnv('MINIMAX_API_KEY', 'fixture-only');
    expect(getCapabilities().asr.opusUpload).toBe(true);
    vi.stubEnv('BREAD_OPUS_UPLOAD', 'off'); expect(getCapabilities().asr.opusUpload).toBeUndefined();
  });
});

describe('bounded Opus admission', () => {
  it('accepts the real browser encoder fixture, passing it to the existing ASR provider once', async () => {
    vi.stubEnv('ASR_PROVIDER', 'minimax'); vi.stubEnv('MINIMAX_API_KEY', 'fixture-only');
    const file = ogg(), signal = new AbortController().signal;
    await validateOpus(file, signal);
    const fetcher = vi.fn(async (_: RequestInfo | URL, init?: RequestInit) => {
      const sent = (init!.body as FormData).get('file') as File;
      expect(sent.type).toBe('audio/ogg'); expect(await sent.arrayBuffer()).toEqual(await file.arrayBuffer());
      return Response.json({ text: '今晚，先说说。', duration: 1.35 });
    });
    expect(await transcribe(file, signal, fetcher)).toBe('今晚，先说说。'); expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['truncated', 'junk', 'chain', 'wrong-type', 'over-limit'])('rejects %s before any ASR request', async kind => {
    vi.stubEnv('ASR_PROVIDER', 'minimax'); vi.stubEnv('MINIMAX_API_KEY', 'fixture-only');
    const bytes = new Uint8Array(await ogg().arrayBuffer());
    const payload = kind === 'truncated' ? bytes.slice(0, -1) : kind === 'junk' ? new Uint8Array(300) : kind === 'chain' ? new Uint8Array([...bytes, ...bytes]) : kind === 'over-limit' ? new Uint8Array(2 * 1024 * 1024 + 1) : bytes;
    const file = new File([payload], 'speech.ogg', { type: kind === 'wrong-type' ? 'audio/webm' : 'audio/ogg' });
    const fetcher = vi.fn(); await expect(transcribe(file, new AbortController().signal, fetcher)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('aborts before parsing or billing', async () => {
    const abort = new AbortController(); abort.abort();
    await expect(validateOpus(ogg(), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it.each([false, true])('rejects excess packet duration, including a forged final timestamp (%s)', async forged => {
    const input = new Input({ source: new BlobSource(ogg()), formats: [OGG] });
    try {
      const track = (await input.getPrimaryAudioTrack())!, packet = (await new EncodedPacketSink(track).getFirstPacket())!;
      const source = new EncodedAudioPacketSource('opus'), target = new BufferTarget();
      const output = new Output({ format: new OggOutputFormat(), target }); output.addAudioTrack(source); await output.start();
      for (let i = 0; i < 3300; i++) await source.add(new EncodedPacket(packet.data, 'key', i * .02, .02), { decoderConfig: (await track.getDecoderConfig())! });
      await output.finalize(); const bytes = new Uint8Array(target.buffer!);
      if (forged) {
        const view = new DataView(bytes.buffer); let offset = 0, last = 0;
        while (offset < bytes.length) { last = offset; const count = bytes[offset + 26]; let length = 27 + count; for (let i = 0; i < count; i++) length += bytes[offset + 27 + i]; offset += length; }
        view.setBigUint64(last + 6, 48000n, true);
      }
      await expect(validateOpus(new File([bytes], 'long.ogg', { type: 'audio/ogg' }), new AbortController().signal)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    } finally { input.dispose(); }
  });
});
