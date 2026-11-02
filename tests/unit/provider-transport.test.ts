import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server, type RequestListener } from 'node:http';
import { createProviderTransport, configuredProviderOrigins } from '../../deployment/node/provider-transport';
import { providerFetch } from '@/server/provider-fetch';
import { withServerRuntime } from '@/server/runtime';
import { RealProvider } from '@/server/providers/real-agent';
import { synthesize } from '@/server/providers/speech';
import { requestFixture } from '@/fixtures/scenarios';

const servers: Server[] = [], pools: ReturnType<typeof createProviderTransport>[] = [];
afterEach(async () => {
  await Promise.all(pools.splice(0).map(p => p.destroy()));
  await Promise.all(servers.splice(0).map(s => new Promise<void>(resolve => { s.closeAllConnections(); s.close(() => resolve()); })));
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});
async function host(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test address');
  const origin = `http://127.0.0.1:${address.port}`;
  return { server, origin };
}
function pool(origin: string) { const p = createProviderTransport([origin], fetch, { connections: 1, keepAliveTimeout: 1500 }); pools.push(p); return p; }

describe('isolated provider connection reuse', () => {
  it('reuses a socket without caching bodies or credentials and keeps native multipart encoding', async () => {
    let connections = 0; const seen: string[] = [];
    const { origin, server } = await host(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
      seen.push(req.headers.authorization ?? ''); res.setHeader('Keep-Alive', '');
      res.end(JSON.stringify({ type: req.headers['content-type'], text: Buffer.concat(chunks).toString() }));
    });
    server.on('connection', () => connections++); const p = pool(origin);
    const a = await p.fetch(origin, { method: 'POST', headers: { Authorization: 'fixture-A' }, body: 'first' });
    expect((await a.json()).text).toBe('first');
    await new Promise(resolve => setTimeout(resolve, 200));
    const form = new FormData(); form.append('file', new File(['second'], 'synthetic.wav'));
    const b = await p.fetch(origin, { method: 'POST', headers: { Authorization: 'fixture-B' }, body: form });
    const body = await b.json(); expect(body.type).toContain('multipart/form-data; boundary='); expect(body.text).toContain('second');
    expect(seen).toEqual(['fixture-A', 'fixture-B']); expect(connections).toBe(1);
  });
  it('never follows a redirect or sends a request to an unconfigured origin', async () => {
    let reached = 0;
    const other = await host((_req, res) => { reached++; res.end('unreachable'); });
    const { origin } = await host((_req, res) => { res.writeHead(307, { Location: other.origin }); res.end(); });
    const p = pool(origin); const response = await p.fetch(origin, { method: 'POST', body: 'private fixture', redirect: 'follow' });
    expect(response.status).toBe(307); await response.text();
    await expect(p.fetch(other.origin)).rejects.toThrow('Unconfigured provider'); expect(reached).toBe(0);
  });
  it('cancels a stalled response, frees the only slot and never replays the canceled POST', async () => {
    let requests = 0;
    const { origin } = await host((req, res) => { requests++; req.resume(); if (requests === 1) { res.writeHead(200); res.write('partial'); } else res.end('next'); });
    const p = pool(origin), pending = new AbortController();
    const response = await p.fetch(origin, { method: 'POST', body: 'one', signal: pending.signal });
    const body = response.text(); const rejection = expect(body).rejects.toMatchObject({ name: 'AbortError' });
    pending.abort(); await rejection;
    expect(await (await p.fetch(origin, { method: 'POST', body: 'two' })).text()).toBe('next'); expect(requests).toBe(2);
  });
  it('reconnects when the server closes its socket between turns', async () => {
    let requests = 0, connections = 0;
    const { origin, server } = await host((_req, res) => { requests++; res.setHeader('Connection', 'close'); res.end('ok'); });
    server.on('connection', () => connections++); const p = pool(origin);
    for (let n = 0; n < 2; n++) expect(await (await p.fetch(origin, { method: 'POST', body: 'one' })).text()).toBe('ok');
    expect(requests).toBe(2); expect(connections).toBe(2);
  });
  it('uses request-scoped transports without replacing native/global fetch', async () => {
    const native = globalThis.fetch;
    const first = vi.fn(async () => Response.json({ lane: 'one' })), second = vi.fn(async () => Response.json({ lane: 'two' }));
    const replies = await Promise.all([
      withServerRuntime({ env: {}, providerFetch: first }, async () => (await providerFetch('https://one.example')).json()),
      withServerRuntime({ env: {}, providerFetch: second }, async () => (await providerFetch('https://two.example')).json()),
    ]);
    expect(replies).toEqual([{ lane: 'one' }, { lane: 'two' }]); expect(globalThis.fetch).toBe(native);
  });
  it('builds the origin list only from explicit endpoints and rejects URL credentials', () => {
    expect(configuredProviderOrigins({ AGENT_BASE_URL: 'https://model.example/v1', AGENT_COMPANION_BASE_URL: 'https://model.example/other', MINIMAX_BASE_URL: 'https://voice.example/v1' })).toEqual(['https://model.example', 'https://voice.example']);
    for (const url of ['https://key@model.example/v1', 'http://model.example/v1', 'https://model.example/v1?key=secret']) expect(() => configuredProviderOrigins({ AGENT_BASE_URL: url })).toThrow();
  });
  it.each(['model', 'speech'])('releases an HTTP error body from the %s provider without retrying', async lane => {
    vi.stubEnv('AGENT_API_KEY', 'fixture'); vi.stubEnv('TTS_PROVIDER', 'minimax'); vi.stubEnv('MINIMAX_API_KEY', 'fixture');
    const cancel = vi.fn(), upstream = vi.fn(async () => new Response(new ReadableStream({ cancel }), { status: 503 }));
    const operation = lane === 'model' ? new RealProvider(upstream).generate(requestFixture(), new AbortController().signal)
      : synthesize('合成测试', new AbortController().signal, upstream);
    await expect(operation).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' }); expect(upstream).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1);
  });
});
