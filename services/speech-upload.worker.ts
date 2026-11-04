import { AudioSample, AudioSampleSource, BufferTarget, OggOutputFormat, Output, Quality } from 'mediabunny';

// Native Opus runs in this dedicated worker. Mediabunny owns framing, encoder delay and Ogg muxing.
async function initialize() {
  try {
    if (typeof AudioEncoder === 'undefined' || !(await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 16000, numberOfChannels: 1, bitrate: 64000 })).supported) throw new Error('unsupported');
    self.postMessage({ type: 'ready' });
  } catch { self.postMessage({ type: 'unsupported' }); }
}
self.onmessage = async ({ data }: MessageEvent<{ id: number; wav: ArrayBuffer }>) => {
  const { id, wav } = data;
  let output: Output | undefined, sample: AudioSample | undefined;
  try {
    const view = new DataView(wav), tag = (at: number) => view.getUint32(at, false);
    // Only the canonical WAV produced by our microphone adapter; unknown files keep their original path.
    if (wav.byteLength < 44 || wav.byteLength > 44 + 65 * 32000 || tag(0) !== 0x52494646 || tag(8) !== 0x57415645 || tag(12) !== 0x666d7420 || view.getUint32(16, true) !== 16 || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint32(24, true) !== 16000 || view.getUint16(34, true) !== 16 || tag(36) !== 0x64617461 || view.getUint32(40, true) !== wav.byteLength - 44 || (wav.byteLength - 44) % 2) throw new Error('format');
    const target = new BufferTarget(), source = new AudioSampleSource({ codec: 'opus', quality: new Quality({ bitrate: 64000 }) });
    output = new Output({ format: new OggOutputFormat(), target }); output.addAudioTrack(source);
    await output.start();
    sample = new AudioSample({ format: 's16', sampleRate: 16000, numberOfChannels: 1, timestamp: 0, data: new Uint8Array(wav, 44) });
    await source.add(sample); sample.close(); sample = undefined;
    await output.finalize();
    const bytes = target.buffer!; self.postMessage({ id, bytes }, { transfer: [bytes] });
  } catch { self.postMessage({ id }); }
  finally { sample?.close(); if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {}); }
};
void initialize();
