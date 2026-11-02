import { Agent } from 'undici';

/** Only configured upstream origins participate; never change Next's global fetch/dispatcher. */
export function configuredProviderOrigins(env: Record<string, string | undefined>): string[] {
  return [...new Set([
    env.AGENT_BASE_URL || 'http://127.0.0.1:3425/v1',
    env.AGENT_COMPANION_BASE_URL,
    env.MINIMAX_BASE_URL || 'https://api.minimax.cn/v1',
  ].filter((value): value is string => !!value).map(value => {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
      throw new Error('Provider endpoint must be HTTPS or an explicit local endpoint');
    }
    return url.origin;
  }))];
}

/** Bounded idle reuse, no keep-warm calls, response cache, POST retry or pipelining. */
export function createProviderTransport(origins: string[], nativeFetch: typeof fetch = globalThis.fetch,
  options: { connections?: number; keepAliveTimeout?: number } = {}) {
  const allowed = new Set(origins);
  const dispatcher = new Agent({
    connections: options.connections ?? 12,
    pipelining: 1,
    keepAliveTimeout: options.keepAliveTimeout ?? 60000,
    keepAliveMaxTimeout: options.keepAliveTimeout ?? 60000,
    keepAliveTimeoutThreshold: 2000,
    connectTimeout: 10000,
    allowH2: false,
  });
  const pooledFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!allowed.has(url.origin) || url.username || url.password) return Promise.reject(new TypeError('Unconfigured provider origin'));
    // Native fetch keeps its native FormData/Response implementation; the Agent owns sockets only.
    const request: RequestInit & { dispatcher: Agent } = { ...init, redirect: 'manual', dispatcher };
    return nativeFetch(input, request);
  };
  return { fetch: pooledFetch, close: () => dispatcher.close(), destroy: () => dispatcher.destroy() };
}
