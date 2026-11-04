import { BlobSource, EncodedPacketSink, Input, OGG } from 'mediabunny';
import { AppError } from '@/server/errors';

const invalid = () => new AppError('UNSUPPORTED_MEDIA', 415);

/** Limit the container to one complete, contiguous logical stream before invoking a general media parser. */
function checkPages(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0, serial = 0, sequence = 0, ended = false;
  while (offset < bytes.length) {
    if (ended || offset + 27 > bytes.length || view.getUint32(offset) !== 0x4f676753 || bytes[offset + 4] !== 0 || ++sequence > 4096) throw invalid();
    const flags = bytes[offset + 5], segments = bytes[offset + 26];
    if (flags & ~7 || !segments || offset + 27 + segments > bytes.length || view.getUint32(offset + 18, true) !== sequence - 1) throw invalid();
    if (sequence === 1) { if (flags !== 2) throw invalid(); serial = view.getUint32(offset + 14, true); }
    else if (flags & 2 || view.getUint32(offset + 14, true) !== serial) throw invalid();
    let size = 27 + segments;
    for (let i = 0; i < segments; i++) size += bytes[offset + 27 + i];
    if (offset + size > bytes.length) throw invalid();
    ended = !!(flags & 4); offset += size;
  }
  if (!ended || sequence < 3) throw invalid();
}

/** Read duration from the real Opus packets as well as container timing; a forged granule can't hide minutes of audio. */
function packetSeconds(packet: Uint8Array) {
  if (!packet.length || packet.length > 1275 * 48 + 2) throw invalid();
  const config = packet[0] >> 3, code = packet[0] & 3;
  const frameMs = config < 12 ? [10, 20, 40, 60][config & 3] : config < 16 ? [10, 20][config & 1] : [2.5, 5, 10, 20][config & 3];
  const count = code === 0 ? 1 : code < 3 ? 2 : (packet[1] ?? 0) & 63;
  if (!count || frameMs * count > 120) throw invalid();
  return frameMs * count / 1000;
}

export async function validateOpus(file: File, signal: AbortSignal) {
  if (file.type.split(';')[0] !== 'audio/ogg' || file.size < 47 || file.size > 2 * 1024 * 1024) throw invalid();
  signal.throwIfAborted(); checkPages(new Uint8Array(await file.arrayBuffer())); signal.throwIfAborted();
  const input = new Input({ source: new BlobSource(file), formats: [OGG] });
  try {
    const tracks = await input.getTracks(), track = tracks[0];
    if (tracks.length !== 1 || !track?.isAudioTrack() || await track.getCodec() !== 'opus' || await track.getNumberOfChannels() !== 1 || await track.getSampleRate() !== 48000) throw invalid();
    let duration = 0, count = 0, end = 0;
    for await (const packet of new EncodedPacketSink(track).packets()) {
      signal.throwIfAborted(); duration += packetSeconds(packet.data); end = packet.timestamp + packet.duration;
      // A single encoder-delay/padding allowance, not one allowance per page or packet.
      if (++count > 4096 || duration > 65.12 || !Number.isFinite(end) || packet.timestamp < -.12 || end > 65.001) throw invalid();
    }
    if (!count || end <= 0 || Math.abs(duration - end) > .12) throw invalid();
  } catch (error) { signal.throwIfAborted(); if (error instanceof AppError) throw error; throw invalid(); }
  finally { input.dispose(); }
}
