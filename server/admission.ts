import { createHash } from 'node:crypto';
import { AppError } from './errors';
import { acquireBudget, claimRequest } from './limits';
import { publicOrigin, requestPrincipal } from './visitor';
import { serverRuntime, type SqlDatabase } from './runtime';
import { withAbort } from '@/lib/abort';
import type { ServiceLane } from './resilience';

export const SHARED_LIMITS = { daily: 1200, clientDaily: 360, minute: 120, clientMinute: 60, active: 12, clientActive: 2, leaseMs: 120000 } as const;
const laneCapacity: Record<ServiceLane, number> = { call: 4, companion: 4, analysis: 2, asr: 4, tts: 4 };
const DAY = 86400000;
const requestScope = (lane: ServiceLane) => ['call', 'companion', 'analysis'].includes(lane) ? 'agent' : lane;
const INSERT = `INSERT INTO bread_requests (id, principal, lane, created_at, active_until, expires_at)
SELECT ?, ?, ?, ?, ?, ? WHERE
  NOT EXISTS (SELECT 1 FROM bread_requests WHERE id = ?)
  AND (SELECT count(*) FROM bread_requests WHERE created_at > ?) < ?
  AND (SELECT count(*) FROM bread_requests WHERE principal = ? AND created_at > ?) < ?
  AND (SELECT count(*) FROM bread_requests WHERE created_at > ?) < ?
  AND (SELECT count(*) FROM bread_requests WHERE principal = ? AND created_at > ?) < ?
  AND (SELECT count(*) FROM bread_requests WHERE active_until > ?) < ?
  AND (SELECT count(*) FROM bread_requests WHERE principal = ? AND active_until > ?) < ?
  AND (SELECT count(*) FROM bread_requests WHERE lane = ? AND active_until > ?) < ?`;

/** Atomic admission across isolates; records contain no prompts, IP addresses, audio or replies. */
export async function acquireShared(db: SqlDatabase, principal: string, lane: ServiceLane, requestId: string, now = Date.now()): Promise<() => Promise<void>> {
  const id = createHash('sha256').update(`${principal}:${requestScope(lane)}:${requestId}`).digest('hex');
  const result = await db.batch([
    db.prepare('DELETE FROM bread_requests WHERE expires_at <= ?').bind(now),
    db.prepare(INSERT).bind(id, principal, lane, now, now + SHARED_LIMITS.leaseMs, now + DAY,
      id, now - DAY, SHARED_LIMITS.daily, principal, now - DAY, SHARED_LIMITS.clientDaily,
      now - 60000, SHARED_LIMITS.minute, principal, now - 60000, SHARED_LIMITS.clientMinute,
      now, SHARED_LIMITS.active, principal, now, SHARED_LIMITS.clientActive, lane, now, laneCapacity[lane]),
  ]);
  if (result[1]?.meta.changes !== 1) {
    const duplicate = await db.prepare('SELECT id FROM bread_requests WHERE id = ?').bind(id).first();
    if (duplicate) throw new AppError('DUPLICATE_REQUEST', 409);
    throw new AppError('RATE_LIMITED', 429, true, 60);
  }
  let released = false;
  return async () => {
    if (released) return;
    await db.prepare('UPDATE bread_requests SET active_until = 0 WHERE id = ?').bind(id).run();
    released = true;
  };
}

export async function admit(req: Request, lane: ServiceLane, requestId: string, signal: AbortSignal): Promise<() => Promise<void>> {
  signal.throwIfAborted();
  const principal = requestPrincipal(req);
  const releaseLocal = acquireBudget(lane);
  let releaseShared: (() => Promise<void>) | undefined;
  try {
    if (publicOrigin()) {
      const runtime = serverRuntime();
      // A public paid endpoint cannot silently degrade to per-instance accounting.
      if (!runtime?.db) throw new AppError('PROVIDER_UNAVAILABLE', 503, true);
      const pending = acquireShared(runtime.db, principal, lane, requestId);
      try { releaseShared = await withAbort(pending, AbortSignal.any([signal, AbortSignal.timeout(2500)])); }
      catch (error) {
        const cleanup = pending.then(release => release(), () => {}).catch(() => {});
        runtime.defer?.(cleanup);
        throw error;
      }
    } else claimRequest(requestScope(lane), requestId);
    signal.throwIfAborted();
  } catch (error) {
    releaseLocal();
    if (releaseShared) { const cleanup = releaseShared().catch(() => {}); serverRuntime()?.defer?.(cleanup); }
    if (error instanceof AppError || error instanceof DOMException) throw error;
    throw new AppError('PROVIDER_UNAVAILABLE', 503, true);
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true; releaseLocal();
    if (releaseShared) {
      const cleanup = releaseShared().catch(() => {});
      const runtime = serverRuntime();
      if (runtime?.defer) runtime.defer(cleanup);
      else await withAbort(cleanup, AbortSignal.timeout(2500)).catch(() => {});
    }
  };
}
