import { config } from '@/server/config';
import { AppError } from '@/server/errors';
import { readProviderJson, retryAfterSeconds } from './response';
import { withAbort } from '@/lib/abort';
import { maxOpusBytes, validateOpus } from './opus-upload';
import { providerFetch } from '@/server/provider-fetch';
import { readAudioEnvelope } from '@/server/audio-envelope';
import { CHAT_ASR_SECONDS, INTERVIEW_ASR_SECONDS, WAV_BYTES_PER_SECOND, pcmWavBytes } from '@/domain/speech-limits';

export { CHAT_ASR_SECONDS, INTERVIEW_ASR_SECONDS };
export const SPEECH_UPLOAD_METADATA_BYTES = 8192;
const WAV_OVERHEAD_BYTES = 4096;
const maxWavBytes = (seconds: number) => pcmWavBytes(seconds) + WAV_OVERHEAD_BYTES;
export const CHAT_AUDIO_BYTES = maxWavBytes(CHAT_ASR_SECONDS);

/** The profile arrives in the form. Use the bounded interview envelope while
 * reading it and apply the selected profile's limits during media validation. */
export function readSpeechUpload(req: Request, metadataBytes = SPEECH_UPLOAD_METADATA_BYTES) {
  const interviewBytes = Math.max(maxWavBytes(INTERVIEW_ASR_SECONDS), maxOpusBytes(INTERVIEW_ASR_SECONDS));
  return readAudioEnvelope(req, interviewBytes + metadataBytes);
}
export async function synthesize(text: string, signal: AbortSignal, fetcher: typeof fetch = providerFetch): Promise<Uint8Array> {
  const c = config();
  if (!c.tts || !c.miniKey) throw new AppError('PROVIDER_UNAVAILABLE', 503);
  const res = await fetcher(`${c.miniBaseUrl.replace(/\/$/, '')}/t2a_v2`, { method: 'POST', headers: { Authorization: `Bearer ${c.miniKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: c.speechModel, text, stream: false, output_format: 'hex', voice_setting: { voice_id: c.voice, speed: c.speechSpeed, vol: 1, pitch: 0 }, audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 }, language_boost: 'Chinese' }), signal, redirect: 'manual', cache: 'no-store' });
  if (!res.ok) { void res.body?.cancel().catch(() => {}); throw new AppError(res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', res.status === 429 ? 429 : 502, true, retryAfterSeconds(res)); }
  const data = await readProviderJson(res, 21 * 1024 * 1024, signal) as { data?: { audio?: unknown; status?: number }; base_resp?: { status_code?: number } };
  const hex = data.data?.audio;
  if (data.base_resp?.status_code !== 0 || data.data?.status !== 2 || typeof hex !== 'string' || !hex.length || hex.length % 2 || !/^[\da-fA-F]+$/.test(hex) || hex.length > 20 * 1024 * 1024) throw new AppError('PROVIDER_UNAVAILABLE', 502, true);
  signal.throwIfAborted(); return new Uint8Array(Buffer.from(hex, 'hex'));
}
const accepted = new Set(['audio/wav', 'audio/x-wav']);
export function validateAudio(file: File, maxSeconds = CHAT_ASR_SECONDS) {
  if (!accepted.has(file.type.split(';')[0]) || file.size < 44 || file.size > maxWavBytes(maxSeconds)) throw new AppError('UNSUPPORTED_MEDIA', 415);
}
export async function validateWav(file: File, maxSeconds = CHAT_ASR_SECONDS) {
  validateAudio(file, maxSeconds);
  // The browser adapter always sends this exact format. Verify real bytes and duration before billing ASR.
  const bytes = await file.arrayBuffer(); const view = new DataView(bytes);
  const decoder = new TextDecoder(), text = (offset: number) => decoder.decode(new Uint8Array(bytes, offset, 4));
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE' || view.getUint32(4,true) !== bytes.byteLength - 8) throw new AppError('UNSUPPORTED_MEDIA',415);
  let offset = 12, format = false, dataBytes = 0;
  while (offset + 8 <= bytes.byteLength) {
    const type = text(offset); const size = view.getUint32(offset+4,true); const start = offset+8;
    offset = start + size + (size % 2);
    if (offset > bytes.byteLength) throw new AppError('UNSUPPORTED_MEDIA',415);
    if (type === 'fmt ') {
      if (size < 16 || view.getUint16(start,true) !== 1 || view.getUint16(start+2,true) !== 1 || view.getUint32(start+4,true) !== 16000 || view.getUint16(start+14,true) !== 16) throw new AppError('UNSUPPORTED_MEDIA',415);
      format = true;
    }
    if (type === 'data') dataBytes += size;
    if (offset - dataBytes > WAV_OVERHEAD_BYTES) throw new AppError('UNSUPPORTED_MEDIA',415);
  }
  if (!format || !dataBytes || dataBytes > maxSeconds * WAV_BYTES_PER_SECOND || offset !== bytes.byteLength) throw new AppError('UNSUPPORTED_MEDIA',415);
}
export async function transcribe(file: File, signal: AbortSignal, fetcher: typeof fetch = providerFetch, maxSeconds = CHAT_ASR_SECONDS): Promise<string> {
  const c = config();
  if (!c.asr || !c.miniKey) throw new AppError('PROVIDER_UNAVAILABLE', 503);
  if (file.type.split(';')[0] === 'audio/ogg') await validateOpus(file, signal, maxSeconds);
  else await validateWav(file, maxSeconds);
  // At most one sequential retry within the original request deadline/admission slot.
  // No duplicate browser request, no hedge, no retry after cancellation or a quota/auth rejection.
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    let status: number | undefined, providerCode: number | undefined;
    try {
      const data = new FormData(); data.append('model', c.asrModel); data.append('file', file); data.append('response_format', 'json'); data.append('stream', 'false');
      const res = await withAbort(fetcher(`${c.miniBaseUrl.replace(/\/$/, '')}/speech_to_text`, { method: 'POST', headers: { Authorization: `Bearer ${c.miniKey}`, language: 'zh' }, body: data, signal, redirect: 'manual', cache: 'no-store' }), signal);
      status = res.status;
      if (!res.ok) {
        void res.body?.cancel().catch(() => {});
        throw new AppError(status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', status === 429 ? 429 : 502, status >= 500 || status === 429,
          retryAfterSeconds(res));
      }
      const payload = await readProviderJson(res, 64 * 1024, signal) as { text?: unknown; duration?: number; base_resp?: { status_code?: number } };
      providerCode = typeof payload?.base_resp?.status_code === 'number' && Number.isFinite(payload.base_resp.status_code) ? payload.base_resp.status_code : undefined;
      if (providerCode !== undefined && providerCode !== 0) throw new AppError('PROVIDER_UNAVAILABLE', 502, false);
      if (typeof payload?.text !== 'string' || payload.text.length > 4000) throw new AppError('PROVIDER_UNAVAILABLE', 502, true);
      if (typeof payload.duration === 'number' && payload.duration > maxSeconds) throw new AppError('UNSUPPORTED_MEDIA', 415);
      signal.throwIfAborted(); return payload.text.trim();
    } catch (error) {
      signal.throwIfAborted();
      const wait = error instanceof AppError ? error.retryAfterSeconds ?? 0 : 0;
      const retry = attempt === 0 && wait <= 1 && (error instanceof TypeError || (error instanceof AppError && error.code === 'PROVIDER_UNAVAILABLE' && error.retryable));
      // Numeric metadata only: never retain the audio, transcript, upstream body or credentials.
      console.warn(JSON.stringify({ event: 'asr_attempt_failed', attempt: attempt + 1, status, providerCode, retry }));
      if (!retry) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.max(250, wait * 1000));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }
}
