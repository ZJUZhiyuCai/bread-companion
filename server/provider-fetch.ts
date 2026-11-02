import { serverRuntime } from './runtime';

/** Node uses an origin-limited socket pool; Worker/local runtimes retain their native fetch. */
export const providerFetch: typeof fetch = (input, init) => {
  const fetcher = serverRuntime()?.providerFetch ?? globalThis.fetch;
  return fetcher(input, init);
};
