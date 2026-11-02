import { AppError } from '@/server/errors';
import { readStream } from '@/server/read-stream';
/** Retry-After permits either seconds or an HTTP date. Never shorten a future cooldown. */
export function retryAfterSeconds(response: Response, now = Date.now()): number | undefined {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return;
  const seconds = /^\d+$/.test(value) ? Number(value) : /[A-Za-z]/.test(value) ? (Date.parse(value) - now) / 1000 : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.ceil(seconds)) : undefined;
}
export async function readProviderJson(response: Response, limitBytes: number, signal = AbortSignal.timeout(30000)): Promise<unknown> {
  if (!response.body) throw new AppError('PROVIDER_UNAVAILABLE', 502);
  const buffer = await readStream(response.body, limitBytes, signal, () => new AppError('PROVIDER_UNAVAILABLE', 502));
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)); }
  catch { throw new AppError('PROVIDER_UNAVAILABLE', 502, true); }
}
