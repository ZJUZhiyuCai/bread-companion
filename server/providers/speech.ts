import { config } from '@/server/config';
import { AppError } from '@/server/errors';
import { readProviderJson } from './response';
export async function synthesize(text: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Uint8Array> {
  const c = config();
  if (!c.tts || !c.miniKey) throw new AppError('PROVIDER_UNAVAILABLE', 503);
  const res = await fetcher(`${c.miniBaseUrl.replace(/\/$/, '')}/t2a_v2`, { method: 'POST', headers: { Authorization: `Bearer ${c.miniKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: c.speechModel, text, stream: false, output_format: 'hex', voice_setting: { voice_id: c.voice, speed: c.speechSpeed, vol: 1, pitch: 0 }, audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }, language_boost: 'Chinese' }), signal, redirect: 'manual', cache: 'no-store' });
  if (!res.ok) throw new AppError(res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', res.status === 429 ? 429 : 502, true);
  const data = await readProviderJson(res, 21 * 1024 * 1024, signal) as { data?: { audio?: unknown; status?: number }; base_resp?: { status_code?: number } };
  const hex = data.data?.audio;
  if (data.base_resp?.status_code !== 0 || data.data?.status !== 2 || typeof hex !== 'string' || !hex.length || hex.length % 2 || !/^[\da-fA-F]+$/.test(hex) || hex.length > 20 * 1024 * 1024) throw new AppError('PROVIDER_UNAVAILABLE', 502, true);
  signal.throwIfAborted(); return new Uint8Array(Buffer.from(hex, 'hex'));
}
const accepted = new Set(['audio/wav', 'audio/x-wav']);
export function validateAudio(file: File) {
  if (!accepted.has(file.type.split(';')[0]) || file.size < 44 || file.size > 10 * 1024 * 1024) throw new AppError('UNSUPPORTED_MEDIA', 415);
}
export async function validateWav(file: File) {
  validateAudio(file);
  // The browser adapter always sends this exact format. Verify real bytes and duration before billing ASR.
  const bytes = await file.arrayBuffer(); const view = new DataView(bytes); const text = (start: number, end: number) => new TextDecoder().decode(bytes.slice(start, end));
  if (text(0,4) !== 'RIFF' || text(8,12) !== 'WAVE' || view.getUint32(4,true) !== bytes.byteLength - 8) throw new AppError('UNSUPPORTED_MEDIA',415);
  let offset = 12, format = false, duration = 0;
  while (offset + 8 <= bytes.byteLength) {
    const type = text(offset,offset+4); const size = view.getUint32(offset+4,true); const start = offset+8;
    if (start + size > bytes.byteLength) throw new AppError('UNSUPPORTED_MEDIA',415);
    if (type === 'fmt ') {
      if (size < 16 || view.getUint16(start,true) !== 1 || view.getUint16(start+2,true) !== 1 || view.getUint32(start+4,true) !== 16000 || view.getUint16(start+14,true) !== 16) throw new AppError('UNSUPPORTED_MEDIA',415);
      format = true;
    }
    if (type === 'data') duration += size / 32000;
    offset = start + size + (size % 2);
  }
  if (!format || duration <= 0 || duration > 65) throw new AppError('UNSUPPORTED_MEDIA',415);
}
export async function transcribe(file: File, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<string> {
  const c = config();
  if (!c.asr || !c.miniKey) throw new AppError('PROVIDER_UNAVAILABLE', 503);
  await validateWav(file);
  const data = new FormData(); data.append('model', c.asrModel); data.append('file', file); data.append('response_format', 'json'); data.append('stream', 'false');
  const res = await fetcher(`${c.miniBaseUrl.replace(/\/$/, '')}/speech_to_text`, { method: 'POST', headers: { Authorization: `Bearer ${c.miniKey}`, language: 'zh' }, body: data, signal, redirect: 'manual', cache: 'no-store' });
  if (!res.ok) throw new AppError(res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', res.status === 429 ? 429 : 502, true);
  const payload = await readProviderJson(res, 64 * 1024, signal) as { text?: unknown; duration?: number };
  if (typeof payload.text !== 'string' || payload.text.length > 4000) throw new AppError('PROVIDER_UNAVAILABLE', 502, true);
  if (typeof payload.duration === 'number' && payload.duration > 65) throw new AppError('UNSUPPORTED_MEDIA', 415);
  signal.throwIfAborted(); return payload.text.trim();
}
