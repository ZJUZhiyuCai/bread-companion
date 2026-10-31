import { AsyncLocalStorage } from 'node:async_hooks';

export interface SqlStatement {
  bind(...values: (string | number | null)[]): SqlStatement;
  run(): Promise<{ meta: { changes?: number } }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<{ meta: { changes?: number } }[]>;
}
export interface ServerRuntime {
  env: Record<string, unknown>;
  db?: SqlDatabase;
  defer?: (promise: Promise<unknown>) => void;
}
const runtime = new AsyncLocalStorage<ServerRuntime>();
/** Worker secrets and bindings belong to this request, never mutable process-wide state. */
export const withServerRuntime = <T>(context: ServerRuntime, run: () => T): T => runtime.run(context, run);
export const serverRuntime = () => runtime.getStore();
export function serverEnv(): Record<string, string | undefined> {
  const env = runtime.getStore()?.env;
  return env ? Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string')) as Record<string, string> : process.env;
}
