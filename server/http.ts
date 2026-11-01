import { z } from 'zod';
import { AppError, asAppError } from './errors';
import { readStream } from './read-stream';
import { timeoutSignal } from './limits';
import { publicOrigin, requestPrincipal } from './visitor';
import { serverRuntime } from './runtime';

export const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
let readingBodies = 0;
export function assertAppRequest(req: Request) {
  const url = new URL(req.url);
  const hosted = publicOrigin();
  if (hosted) {
    const expected = new URL(hosted);
    const internal = serverRuntime()?.nodeInternalOrigin;
    // NextRequest normalizes both loopback literals to localhost, without changing the port.
    const normalizedInternal = internal?.replace('://127.0.0.1', '://localhost').replace('://[::1]', '://localhost');
    if ((url.origin !== hosted && url.origin !== internal && url.origin !== normalizedInternal) || (req.headers.get('host') ?? url.host) !== expected.host) throw new AppError('PERMISSION_DENIED', 403);
    const origin = req.headers.get('origin');
    if ((req.method !== 'GET' && origin !== hosted) || (origin && origin !== hosted)) throw new AppError('PERMISSION_DENIED', 403);
    if (['cross-site', 'same-site'].includes(req.headers.get('sec-fetch-site') ?? '')) throw new AppError('PERMISSION_DENIED', 403);
    if (req.method !== 'GET') requestPrincipal(req);
    return;
  }
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
export async function readBytes(req: Request, limit: number, signal = timeoutSignal(req.signal, 10000)): Promise<Uint8Array> {
  const declared = req.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new AppError('INVALID_INPUT', 413);
  if (!req.body) throw new AppError('INVALID_INPUT');
  if (readingBodies >= 4) throw new AppError('RATE_LIMITED', 429, true, 1);
  readingBodies++;
  try { return await readStream(req.body, limit, signal, () => new AppError('INVALID_INPUT', 413)); }
  finally { readingBodies--; }
}
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) throw new AppError('INVALID_INPUT', 415);
  let data: unknown;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(req, 128 * 1024))); }
  catch (e) { if (e instanceof AppError || (e instanceof DOMException && ['AbortError', 'TimeoutError'].includes(e.name))) throw e; throw new AppError('INVALID_INPUT'); }
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new AppError('INVALID_INPUT');
  return parsed.data;
}
export function errorResponse(error: unknown, requestId: string, stage: string): Response {
  const err = asAppError(error);
  // Only bounded diagnostic metadata; never log content, headers, keys or upstream bodies.
  if (err.status >= 500) console.warn(JSON.stringify({ event: 'request_failed', requestId, stage, code: err.code, status: err.status }));
  return Response.json({ error: { code: err.code, userMessage: err.message, retryable: err.retryable, requestId, stage } }, { status: err.status, headers: { ...NO_STORE, 'X-Request-Id': requestId, ...(err.status === 429 || err.retryAfterSeconds ? { 'Retry-After': String(err.retryAfterSeconds ?? 60) } : {}) } });
}
export function timingHeaders(start: number, requestId: string, providerMs: number) {
  return { ...NO_STORE, 'X-Request-Id': requestId, 'Server-Timing': `provider;dur=${providerMs.toFixed(1)}, total;dur=${(performance.now() - start).toFixed(1)}` };
}
