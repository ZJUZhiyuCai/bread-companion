import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWav, MediaController, type RecorderLike } from '@/services/media-controller';
function fixture(getStream?: () => Promise<MediaStream>) {
  const track = { stop: vi.fn() }; const stream = { getTracks: () => [track] } as unknown as MediaStream;
  const recorder: RecorderLike = { state: 'inactive', mimeType: 'audio/webm', ondataavailable: null, onstop: null, onerror: null,
    start: vi.fn(() => { recorder.state = 'recording'; recorder.ondataavailable?.({ data: new Blob(['first']) }); }),
    stop: vi.fn(() => { recorder.state = 'inactive'; queueMicrotask(() => { recorder.ondataavailable?.({ data: new Blob(['last']) }); recorder.onstop?.(); }); }) };
  const createRecorder = vi.fn(() => recorder);
  const media = new MediaController({ getUserMedia: getStream ?? (async () => stream), createRecorder });
  return { media, stream, track, recorder, createRecorder };
}
afterEach(() => { vi.useRealTimers(); });
describe('microphone races', () => {
  it('normal finish includes final chunk exactly once', async () => {
    const f = fixture(); await f.media.start(() => true, () => {}, () => {}, () => {});
    const [a,b] = await Promise.all([f.media.finish(),f.media.finish()]);
    expect(await a!.text()).toBe('firstlast'); expect(a).toBe(b); expect(f.recorder.stop).toHaveBeenCalledTimes(1); expect(f.track.stop).toHaveBeenCalledTimes(1);
  });
  it('permission granted after ending stops tracks and never starts a recorder', async () => {
    let resolve!: (stream: MediaStream) => void;
    const f = fixture(() => new Promise(r => { resolve = r; }));
    const starting = f.media.start(() => true, () => {}, () => {}, () => {}); f.media.cancel(); resolve(f.stream);
    expect(await starting).toBe(false); expect(f.track.stop).toHaveBeenCalledTimes(1); expect(f.createRecorder).not.toHaveBeenCalled();
  });
  it('cancel wins even after finish is requested and final callbacks are pending', async () => {
    const f = fixture(); await f.media.start(() => true, () => {}, () => {}, () => {});
    const finishing = f.media.finish(); f.media.cancel(); expect(await finishing).toBeNull(); await Promise.resolve(); expect(await f.media.finish()).toBeNull();
  });
  it('invalidated context drops the final audio', async () => {
    let valid = true; const f = fixture(); await f.media.start(() => valid, () => {}, () => {}, () => {});
    valid = false; expect(await f.media.finish()).toBeNull(); f.media.cancel();
  });
  it('recording limit stops capture and returns a blob for an explicit decision', async () => {
    vi.useFakeTimers(); const f = fixture(); const limit = vi.fn();
    await f.media.start(() => true, () => {}, limit, () => {}, 1);
    await vi.advanceTimersByTimeAsync(1250); expect(limit).toHaveBeenCalledTimes(1); expect(await limit.mock.calls[0][0].text()).toBe('firstlast'); expect(f.track.stop).toHaveBeenCalled(); f.media.cancel();
  });
  it('encodes a real mono PCM WAV header with clipping', () => {
    const bytes = encodeWav(new Float32Array([-2, 0, 2])); const view = new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0,4))).toBe('RIFF'); expect(view.getUint32(24,true)).toBe(16000); expect(view.getUint16(22,true)).toBe(1); expect(view.getInt16(44,true)).toBe(-32768); expect(view.getInt16(48,true)).toBe(32767);
  });
});
