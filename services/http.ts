import { withAbort } from '@/lib/abort';

/** The deadline covers both headers and body, including a disconnected local server. */
export async function fetchComplete(fetcher: typeof fetch, input: RequestInfo | URL, init?: RequestInit, timeoutMs = 60000): Promise<Response> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('这次连接等得有点久，可以再试一次。', 'TimeoutError')), timeoutMs);
  const signal = init?.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal;
  try {
    signal.throwIfAborted();
    const res = await withAbort(fetcher(input, { ...init, signal }), signal);
    const body = await withAbort(res.arrayBuffer(), signal);
    signal.throwIfAborted();
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } finally { clearTimeout(timer); }
}
