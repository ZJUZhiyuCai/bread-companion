import { withAbort } from '@/lib/abort';
import { config } from '@/server/config';
import { AppError } from '@/server/errors';

/** MiniMax HTTP SSE: signed 16-bit little-endian mono PCM at 32 kHz. */
export async function* synthesizeStream(text: string, signal: AbortSignal, fetcher: typeof fetch = fetch): AsyncGenerator<Uint8Array> {
  const c = config();
  if (!c.tts || !c.miniKey) throw new AppError('PROVIDER_UNAVAILABLE', 503);
  const invalid = () => new AppError('PROVIDER_UNAVAILABLE', 502, true);
  const res = await withAbort(fetcher(`${c.miniBaseUrl.replace(/\/$/, '')}/t2a_v2`, {
    method: 'POST', headers: { Authorization: `Bearer ${c.miniKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: c.speechModel, text, stream: true, stream_options: { exclude_aggregated_audio: true }, output_format: 'hex',
      voice_setting: { voice_id: c.voice, speed: c.speechSpeed, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'pcm', channel: 1 }, language_boost: 'Chinese' }),
    signal, redirect: 'manual', cache: 'no-store',
  }), signal);
  if (!res.ok) { void res.body?.cancel().catch(() => {}); throw new AppError(res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', res.status === 429 ? 429 : 502, true); }
  if (!res.body || !res.headers.get('content-type')?.includes('text/event-stream')) { void res.body?.cancel().catch(() => {}); throw invalid(); }
  const reader = res.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', wireBytes = 0, audioBytes = 0, count = 0, data = '';
  try {
    for (;;) {
      const chunk = await withAbort(reader.read(), signal); signal.throwIfAborted();
      if (chunk.done) throw invalid();
      wireBytes += chunk.value.length;
      if (wireBytes > 10 * 1024 * 1024) throw invalid();
      buffer += decoder.decode(chunk.value, { stream: true });
      let n: number;
      while ((n = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, n).replace(/\r$/, ''); buffer = buffer.slice(n + 1);
        if (line.startsWith('data:')) { data += line.slice(5).trimStart(); if (data.length > 1024 * 1024) throw invalid(); }
        else if (!line && data) {
          if (++count > 512) throw invalid();
          let event;
          try { event = JSON.parse(data); } catch { throw invalid(); }
          data = '';
          if (!event || typeof event !== 'object' || (event.base_resp && event.base_resp.status_code !== 0)) throw invalid();
          const status = event.data?.status, hex = event.data?.audio;
          if (status !== 1 && status !== 2) throw invalid();
          if (hex !== undefined && hex !== '') {
            if (typeof hex !== 'string' || hex.length % 4 || !/^[\da-f]+$/i.test(hex)) throw invalid();
            audioBytes += hex.length / 2;
            if (audioBytes > 4 * 1024 * 1024) throw invalid();
            yield new Uint8Array(Buffer.from(hex, 'hex'));
          }
          if (status === 2) {
            const meta = event.extra_info;
            if (!audioBytes || event.base_resp?.status_code !== 0 || meta?.audio_format !== 'pcm' || meta.audio_sample_rate !== 32000 || meta.audio_channel !== 1) throw invalid();
            signal.throwIfAborted(); return;
          }
        }
      }
      if (buffer.length > 1024 * 1024) throw invalid();
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
