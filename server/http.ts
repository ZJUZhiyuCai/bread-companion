import { z } from 'zod';
import { AppError, asAppError } from './errors';

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
export function assertLocalRequest(req: Request) {
  const url = new URL(req.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new AppError('PERMISSION_DENIED', 403);
  // NextURL normalizes loopback addresses to localhost. Compare the browser's
  // Origin with its validated Host header, never an untrusted forwarded header.
  const host = req.headers.get('host') ?? url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host)) throw new AppError('PERMISSION_DENIED', 403);
  let browserUrl: URL;
  try { browserUrl = new URL(`${url.protocol}//${host}`); } catch { throw new AppError('PERMISSION_DENIED', 403); }
  if (browserUrl.port !== url.port) throw new AppError('PERMISSION_DENIED', 403);
  const origin = req.headers.get('origin');
  if (origin && origin !== browserUrl.origin) throw new AppError('PERMISSION_DENIED', 403);
  if (['cross-site', 'same-site'].includes(req.headers.get('sec-fetch-site') ?? '')) throw new AppError('PERMISSION_DENIED', 403);
}
export async function readBytes(req: Request, limit: number): Promise<Uint8Array> {
  const declared = req.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new AppError('INVALID_INPUT', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new AppError('INVALID_INPUT');
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) {
      req.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new AppError('INVALID_INPUT', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total); let position = 0;
  for (const c of chunks) { output.set(c, position); position += c.byteLength; }
  return output;
}
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) throw new AppError('INVALID_INPUT', 415);
  let data: unknown;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(req, 128 * 1024))); }
  catch (e) { if (e instanceof AppError) throw e; throw new AppError('INVALID_INPUT'); }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError('INVALID_INPUT');
  return parsed.data;
}
export function errorResponse(error: unknown, requestId: string, stage: string): Response {
  const err = asAppError(error);
  // Deliberately no exception body, input, headers or third-party error strings in logs/responses.
  return Response.json({ error: { code: err.code, userMessage: err.message, retryable: err.retryable, requestId, stage } }, { status: err.status, headers: NO_STORE });
}
