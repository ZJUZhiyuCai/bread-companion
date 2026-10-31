import { AppError } from '@/server/errors';
import { readStream } from '@/server/read-stream';
export async function readProviderJson(response: Response, limitBytes: number, signal = AbortSignal.timeout(30000)): Promise<unknown> {
  if (!response.body) throw new AppError('PROVIDER_UNAVAILABLE', 502);
  const buffer = await readStream(response.body, limitBytes, signal, () => new AppError('PROVIDER_UNAVAILABLE', 502));
  try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)); }
  catch { throw new AppError('PROVIDER_UNAVAILABLE', 502, true); }
}
