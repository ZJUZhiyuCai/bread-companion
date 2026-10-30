import { AppError } from '@/server/errors';
export async function readProviderJson(response: Response, limitBytes: number): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new AppError('PROVIDER_UNAVAILABLE', 502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limitBytes) { await reader.cancel(); throw new AppError('PROVIDER_UNAVAILABLE', 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk,offset);offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)); }
  catch { throw new AppError('PROVIDER_UNAVAILABLE', 502, true); }
}
