import type { ServerRuntime } from './server/runtime';

/** Node hosting only. Sites uses its request-scoped D1 binding and does not stage this entrypoint. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.BREAD_SQLITE_PATH) return;
  const host = globalThis as typeof globalThis & { __breadNodeRuntime?: ServerRuntime };
  if (host.__breadNodeRuntime) return;
  const nodeInternalOrigin = process.env.BREAD_NODE_INTERNAL_ORIGIN;
  if (nodeInternalOrigin) {
    const url = new URL(nodeInternalOrigin);
    if (!['127.0.0.1', '[::1]'].includes(url.hostname) || url.protocol !== 'https:' || url.origin !== nodeInternalOrigin || url.username || url.password) throw new Error('BREAD_NODE_INTERNAL_ORIGIN must be an HTTPS loopback origin');
  }
  const { openAdmissionDatabase } = await import('./deployment/node/sqlite.mjs');
  host.__breadNodeRuntime = {env: process.env, nodeInternalOrigin, db: openAdmissionDatabase(process.env.BREAD_SQLITE_PATH)};
}
