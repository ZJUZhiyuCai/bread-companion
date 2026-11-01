import {DatabaseSync} from 'node:sqlite';
import {chmodSync} from 'node:fs';

/** Same metadata-only admission contract as D1. Transactions are synchronous across SQLite connections. */
export function openAdmissionDatabase(filename) {
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec(`PRAGMA busy_timeout=2000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS bread_requests (
      id TEXT PRIMARY KEY NOT NULL, principal TEXT NOT NULL, lane TEXT NOT NULL,
      created_at INTEGER NOT NULL, active_until INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bread_created ON bread_requests(created_at);
    CREATE INDEX IF NOT EXISTS bread_principal_created ON bread_requests(principal,created_at);
    CREATE INDEX IF NOT EXISTS bread_active ON bread_requests(active_until);
    CREATE INDEX IF NOT EXISTS bread_expiry ON bread_requests(expires_at);`);
  class Statement {
    constructor(sql, values = []) { this.sql = sql; this.values = values; }
    bind(...values) { return new Statement(this.sql, values); }
    runSync() { const result = db.prepare(this.sql).run(...this.values); return {meta:{changes:Number(result.changes)}}; }
    async run() { return this.runSync(); }
    /** @template T @returns {Promise<T | null>} */
    async first() { return /** @type {T | null} */ (db.prepare(this.sql).get(...this.values) ?? null); }
  }
  return {
    prepare(sql) { return new Statement(sql); },
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try { const results=statements.map(s=>s.runSync()); db.exec('COMMIT'); return results; }
      catch(error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); }
  };
}
