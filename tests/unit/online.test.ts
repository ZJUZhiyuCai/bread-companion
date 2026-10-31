import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireShared, admit, SHARED_LIMITS } from '@/server/admission';
import { withServerRuntime, serverEnv, type SqlDatabase, type SqlStatement } from '@/server/runtime';
import { visitorHeaders, requestPrincipal } from '@/server/visitor';
import { assertAppRequest, readBytes } from '@/server/http';
import { resetLimitsForTest } from '@/server/limits';
import { AppError } from '@/server/errors';
import { resetCircuitsForTest, withCircuit, type ServiceLane } from '@/server/resilience';
import { POST } from '@/app/api/agent/turn/route';
import { GET } from '@/app/api/capabilities/route';
import { requestFixture } from '@/fixtures/scenarios';

const env = { BREAD_PUBLIC_ORIGIN: 'https://bread.example', BREAD_VISITOR_SECRET: 'test-secret-that-is-longer-than-thirty-two-bytes', AGENT_PROVIDER: 'mock', MOCK_DELAY_MS: '1' };
const databases: DatabaseSync[] = [];
function database() {
  const sqlite = new DatabaseSync(':memory:'); databases.push(sqlite);
  sqlite.exec(readFileSync(new URL('../../deployment/sites/drizzle/0000_request_admission.sql', import.meta.url), 'utf8'));
  class Statement implements SqlStatement {
    values: (string | number | null)[] = [];
    constructor(readonly sql: string) {}
    bind(...values: (string | number | null)[]) { this.values = values; return this; }
    async run() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.values).changes) } }; }
    async first<T>() { return (sqlite.prepare(this.sql).get(...this.values) ?? null) as T | null; }
  }
  const db: SqlDatabase = {
    prepare: sql => new Statement(sql),
    // Match D1's ordered, atomic batch; no await between the SQL statements.
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map(s => { const q = s as Statement; return { meta: { changes: Number(sqlite.prepare(q.sql).run(...q.values).changes) } }; });
        sqlite.exec('COMMIT'); return result;
      } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  return { db, sqlite };
}
const publicRequest = (cookie?: string, input = requestFixture(), headers: Record<string, string> = {}) => new Request(env.BREAD_PUBLIC_ORIGIN + '/api/agent/turn', { method: 'POST', headers: { origin: env.BREAD_PUBLIC_ORIGIN, 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(input) });
const cookie = () => visitorHeaders(new Request(env.BREAD_PUBLIC_ORIGIN))['Set-Cookie'].split(';')[0];
afterEach(() => { for (const db of databases.splice(0)) db.close(); resetLimitsForTest(); resetCircuitsForTest(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('hosted origin and opaque visitor boundary', () => {
  it('issues a secure visit cookie and admits a genuine same-origin flow without exposing secrets', async () => {
    const { db } = database();
    await withServerRuntime({ env, db }, async () => {
      const caps = await GET(new Request(env.BREAD_PUBLIC_ORIGIN + '/api/capabilities'));
      const setCookie = caps.headers.get('set-cookie')!;
      expect(setCookie).toContain('HttpOnly; Secure; SameSite=Strict');
      expect(await caps.text()).not.toContain(env.BREAD_VISITOR_SECRET);
      const response = await POST(publicRequest(setCookie.split(';')[0]));
      expect(response.status).toBe(200);
      expect((await response.json()).serviceMode).toBe('mock');
    });
  });
  it('rejects forged/missing cookies, missing Origin, sibling hosts and forwarded-host tricks', () => withServerRuntime({ env }, () => {
    const good = cookie();
    expect(() => assertAppRequest(publicRequest(good))).not.toThrow();
    for (const request of [publicRequest(), publicRequest(good.slice(0, -4) + 'fake'), publicRequest(good, undefined, { origin: 'https://other.bread.example' }), publicRequest(good, undefined, { origin: '', 'x-forwarded-host': 'bread.example' }), publicRequest(good, undefined, { 'sec-fetch-site': 'same-site' }), publicRequest(good, undefined, { host: 'attacker.example' })]) {
      expect(() => assertAppRequest(request)).toThrow();
    }
  }));
  it('expires visitor cookies, rejects ambiguous duplicates, and does not accept another deployment secret', () => {
    const now = 1800000000;
    const issued = withServerRuntime({ env }, () => visitorHeaders(new Request(env.BREAD_PUBLIC_ORIGIN), now)['Set-Cookie'].split(';')[0]);
    withServerRuntime({ env }, () => {
      expect(requestPrincipal(publicRequest(issued), now)).toHaveLength(43);
      expect(() => requestPrincipal(publicRequest(issued), now + 12 * 3600)).toThrow();
      expect(() => requestPrincipal(publicRequest(issued), now - 60)).toThrow();
      expect(() => requestPrincipal(publicRequest(issued + '; ' + issued), now)).toThrow();
    });
    withServerRuntime({ env: { ...env, BREAD_VISITOR_SECRET: 'another-secret-that-is-longer-than-thirty-two' } }, () => expect(() => requestPrincipal(publicRequest(issued), now)).toThrow());
  });
  it('never substitutes process-wide runtime secrets when two hosted requests overlap', async () => {
    let release!: () => void; const pause = new Promise<void>(r => { release = r; });
    const first = withServerRuntime({ env: { marker: 'one' } }, async () => { await pause; return serverEnv().marker; });
    const second = withServerRuntime({ env: { marker: 'two' } }, async () => { release(); await Promise.resolve(); return serverEnv().marker; });
    expect(await Promise.all([first, second])).toEqual(['one', 'two']);
  });
  it('fails closed if hosted shared accounting is unavailable', async () => {
    await withServerRuntime({ env }, async () => expect((await POST(publicRequest(cookie()))).status).toBe(503));
    const { db } = database(); vi.spyOn(db, 'batch').mockRejectedValue(new Error('private-database-detail'));
    await withServerRuntime({ env, db }, async () => { const res = await POST(publicRequest(cookie())); expect(res.status).toBe(503); expect(await res.text()).not.toContain('private-database-detail'); });
  });
});

describe('atomic shared admission under contention', () => {
  it('bounds 100 concurrent requests across clients and lanes, then releases capacity idempotently', async () => {
    const { db, sqlite } = database(); const lanes: ServiceLane[] = ['call', 'companion', 'analysis', 'asr', 'tts'];
    const results = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => acquireShared(db, 'visitor-' + i, lanes[i % 5], 'request-' + i, 1000)));
    const admitted = results.filter(r => r.status === 'fulfilled');
    expect(admitted).toHaveLength(SHARED_LIMITS.active);
    expect(sqlite.prepare('SELECT count(*) AS n FROM bread_requests WHERE active_until > 1000').get()!.n).toBe(12);
    for (const result of admitted) if (result.status === 'fulfilled') { await result.value(); await result.value(); }
    expect(sqlite.prepare('SELECT count(*) AS n FROM bread_requests WHERE active_until > 1000').get()!.n).toBe(0);
    await expect(acquireShared(db, 'another', 'call', 'new', 1001)).resolves.toBeTypeOf('function');
  });
  it('gives ASR and TTS separate capacity when analysis is saturated', async () => {
    const { db } = database();
    await acquireShared(db, 'a', 'analysis', 'r1', 1000); await acquireShared(db, 'b', 'analysis', 'r2', 1000);
    await expect(acquireShared(db, 'c', 'analysis', 'r3', 1000)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(acquireShared(db, 'c', 'call', 'r4', 1000)).resolves.toBeTypeOf('function');
    await expect(acquireShared(db, 'c', 'asr', 'r5', 1000)).resolves.toBeTypeOf('function');
    await expect(acquireShared(db, 'd', 'tts', 'r6', 1000)).resolves.toBeTypeOf('function');
    await expect(acquireShared(db, 'c', 'tts', 'r7', 1000)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
  it('deduplicates across model lanes, isolates visitors, and recovers abandoned leases without replaying paid work', async () => {
    const { db } = database();
    await acquireShared(db, 'a', 'call', 'same', 1000);
    await expect(acquireShared(db, 'a', 'companion', 'same', 1000)).rejects.toMatchObject({ code: 'DUPLICATE_REQUEST' });
    await expect(acquireShared(db, 'b', 'call', 'same', 1000)).resolves.toBeTypeOf('function');
    await acquireShared(db, 'a', 'asr', 'other', 1000);
    await expect(acquireShared(db, 'a', 'tts', 'new', 1000)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(acquireShared(db, 'a', 'tts', 'new', 121001)).resolves.toBeTypeOf('function');
    await expect(acquireShared(db, 'a', 'call', 'same', 121001)).rejects.toMatchObject({ code: 'DUPLICATE_REQUEST' });
  });
  it('caps the rolling daily budget across deployments, retains no content, and cleans expired metadata', async () => {
    const { db, sqlite } = database(); const now = 100000000;
    const insert = sqlite.prepare('INSERT INTO bread_requests VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < SHARED_LIMITS.daily; i++) insert.run('seed-' + i, 'visitor-' + i, 'call', now - 3600000, 0, now + 82800000);
    await expect(acquireShared(db, 'fresh', 'tts', 'budget', now)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await acquireShared(db, 'fresh', 'tts', 'after-expiry', now + 86400001);
    expect(sqlite.prepare('SELECT count(*) AS n FROM bread_requests').get()!.n).toBe(1);
    expect(Object.keys(sqlite.prepare('SELECT * FROM bread_requests').get()!)).toEqual(['id', 'principal', 'lane', 'created_at', 'active_until', 'expires_at']);
  });
  it('cleans a late successful database admission after the caller has already cancelled', async () => {
    const { db, sqlite } = database(); const original = db.batch;
    let continueBatch!: () => void; const held = new Promise<void>(r => { continueBatch = r; });
    db.batch = async statements => { await held; return original(statements); };
    const background: Promise<unknown>[] = []; const aborter = new AbortController();
    await withServerRuntime({ env, db, defer: p => background.push(p) }, async () => {
      const request = publicRequest(cookie());
      const pending = admit(request, 'call', 'cancelled', aborter.signal);
      aborter.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      continueBatch(); await Promise.all(background);
    });
    expect(sqlite.prepare('SELECT count(*) AS n FROM bread_requests WHERE active_until > 0').get()!.n).toBe(0);
  });
});

describe('outage isolation and bounded intake', () => {
  it('opens only the failing capability and allows exactly one recovery probe', async () => {
    let now = 1000; const failed = vi.fn(async () => { throw new AppError('PROVIDER_UNAVAILABLE', 502, true); });
    for (let i = 0; i < 3; i++) await expect(withCircuit('tts', failed, () => now)).rejects.toBeInstanceOf(AppError);
    await expect(withCircuit('tts', failed, () => now)).rejects.toMatchObject({ retryAfterSeconds: 15 });
    expect(failed).toHaveBeenCalledTimes(3);
    await expect(withCircuit('asr', async () => 'heard', () => now)).resolves.toBe('heard');
    now += 15001; let finish!: () => void;
    const probe = withCircuit('tts', () => new Promise<void>(r => { finish = r; }), () => now);
    await expect(withCircuit('tts', failed, () => now)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    finish(); await probe;
    await expect(withCircuit('tts', async () => 'voice', () => now)).resolves.toBe('voice');
  });
  it('does not treat user cancellation or invalid media as an upstream outage', async () => {
    for (let i = 0; i < 4; i++) await expect(withCircuit('asr', async () => { throw new DOMException('cancelled', 'AbortError'); })).rejects.toMatchObject({ name: 'AbortError' });
    for (let i = 0; i < 4; i++) await expect(withCircuit('asr', async () => { throw new AppError('UNSUPPORTED_MEDIA', 415); })).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    await expect(withCircuit('asr', async () => 'ok')).resolves.toBe('ok');
  });
  it('a late old success cannot close a circuit opened by newer failures', async () => {
    let finish!: () => void; const old = withCircuit('call', () => new Promise<void>(r => { finish = r; }));
    for (let i = 0; i < 3; i++) await expect(withCircuit('call', async () => { throw new AppError('TIMEOUT', 504, true); })).rejects.toBeInstanceOf(AppError);
    finish(); await old;
    await expect(withCircuit('call', async () => 'not called')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
  it('bounds stalled incoming bodies and releases all slots when aborted', async () => {
    const controllers = Array.from({ length: 4 }, () => new AbortController());
    const stalled = () => new Request('http://localhost/', { method: 'POST', body: new ReadableStream({ start() {} }), duplex: 'half' } as RequestInit);
    const pending = controllers.map(c => readBytes(stalled(), 100, c.signal));
    const settled = Promise.allSettled(pending);
    await expect(readBytes(stalled(), 100)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    controllers.forEach(c => c.abort()); await settled;
    await expect(readBytes(new Request('http://localhost/', { method: 'POST', body: 'ok' }), 100)).resolves.toEqual(new Uint8Array([111, 107]));
  });
});
