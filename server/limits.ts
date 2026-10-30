import { AppError } from './errors';

// Local-only application: a process-wide bucket avoids trusting spoofed IP headers.
const windows = new Map<string, { minute: number; minuteCount: number; hour: number; hourCount: number; active: number }>();
export function acquireBudget(scope: string, now = Date.now()): () => void {
  const b = windows.get(scope) ?? { minute: now, minuteCount: 0, hour: now, hourCount: 0, active: 0 };
  if (now - b.minute >= 60000) { b.minute = now; b.minuteCount = 0; }
  if (now - b.hour >= 3600000) { b.hour = now; b.hourCount = 0; }
  if (b.minuteCount >= 30 || b.hourCount >= 240 || b.active >= 3) throw new AppError('RATE_LIMITED', 429, true);
  b.minuteCount++; b.hourCount++; b.active++; windows.set(scope, b);
  let released = false;
  return () => { if (!released) { released = true; b.active--; } };
}
export function resetLimitsForTest() { windows.clear(); }
export function timeoutSignal(signal: AbortSignal, ms: number) { return AbortSignal.any([signal, AbortSignal.timeout(ms)]); }
