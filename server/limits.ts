import { AppError } from './errors';

// Per-process bulkheads complement the hosted atomic admission store. No spoofable IP keys.
const windows = new Map<string, { minute: number; minuteCount: number; hour: number; hourCount: number; active: number }>();
const requests = new Map<string, number>();
/** Metadata only; no response or conversation cache. Explicit retries use a fresh request id. */
export function claimRequest(scope: string, requestId: string, now = Date.now()) {
  for (const [key, expires] of requests) if (expires <= now) requests.delete(key);
  const key = `${scope}:${requestId}`;
  if (requests.has(key)) throw new AppError('DUPLICATE_REQUEST', 409);
  if (requests.size >= 1024) throw new AppError('RATE_LIMITED', 429, true);
  requests.set(key, now + 10 * 60000);
}
export function acquireBudget(scope: string, now = Date.now(), concurrency = 3): () => void {
  const b = windows.get(scope) ?? { minute: now, minuteCount: 0, hour: now, hourCount: 0, active: 0 };
  if (now - b.minute >= 60000) { b.minute = now; b.minuteCount = 0; }
  if (now - b.hour >= 3600000) { b.hour = now; b.hourCount = 0; }
  if (b.minuteCount >= 30 || b.hourCount >= 240 || b.active >= concurrency) {
    const wait = b.hourCount >= 240 ? b.hour + 3600000 - now : b.minuteCount >= 30 ? b.minute + 60000 - now : 1000;
    throw new AppError('RATE_LIMITED', 429, true, Math.max(1, Math.ceil(wait / 1000)));
  }
  b.minuteCount++; b.hourCount++; b.active++; windows.set(scope, b);
  let released = false;
  return () => { if (!released) { released = true; b.active--; } };
}
export function resetLimitsForTest() { windows.clear(); requests.clear(); }
export function timeoutSignal(signal: AbortSignal, ms: number) { return AbortSignal.any([signal, AbortSignal.timeout(ms)]); }
