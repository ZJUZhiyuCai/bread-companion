import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/agent/turn/route';
import { GET } from '@/app/api/capabilities/route';
import { POST as ASR } from '@/app/api/speech/transcribe/route';
import { acquireBudget, resetLimitsForTest } from '@/server/limits';
import { RealProvider } from '@/server/providers/real-agent';
import { synthesize, transcribe } from '@/server/providers/speech';
import { requestFixture } from '@/fixtures/scenarios';
import { mockCandidate } from '@/server/providers/mock-agent';
import { needsImmediateSupport } from '@/domain/policy';
import { encodeWav } from '@/services/media-controller';
const request = (body: unknown, headers = {}) => new Request('http://localhost:3210/api/agent/turn', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
beforeEach(() => { resetLimitsForTest(); vi.stubEnv('AGENT_PROVIDER', 'mock'); vi.stubEnv('MOCK_DELAY_MS', '1'); });
afterEach(() => { vi.unstubAllEnvs(); });
describe('server boundaries', () => {
  it('returns a validated Mock candidate with no-store and controller identifiers', async () => {
    const input = requestFixture(); const res = await POST(request(input)); expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json(); expect(body.requestId).toBe(input.requestId); expect(body.serviceMode).toBe('mock');
  });
  it('rejects cross-site, remote-host and malformed requests', async () => {
    expect((await POST(request(requestFixture(), { Origin: 'https://attacker.example' }))).status).toBe(403);
    expect((await POST(request(requestFixture(), { 'Sec-Fetch-Site': 'cross-site' }))).status).toBe(403);
    expect((await POST(new Request('http://public.example/api/agent/turn', { method:'POST',body:'{}' }))).status).toBe(403);
    expect((await POST(request({ ...requestFixture(), userMessage: '中'.repeat(4001) }))).status).toBe(400);
    expect((await POST(request(requestFixture(), { 'Content-Length': '999999' }))).status).toBe(413);
  });
  it('bounds actual bytes even if the claimed content length is absent', async () => {
    const body = JSON.stringify({ ...requestFixture(), userMessage: 'x'.repeat(150000) });
    const res = await POST(new Request('http://localhost:3210/api/agent/turn', { method:'POST', headers:{'Content-Type':'application/json'},body })); expect(res.status).toBe(413);
  });
  it('handles NextURL loopback normalization while enforcing exact browser origin and port', async () => {
    expect((await POST(request(requestFixture(), { Host: '127.0.0.1:3210', Origin: 'http://127.0.0.1:3210', 'Sec-Fetch-Site': 'same-origin' }))).status).toBe(200);
    expect((await POST(request(requestFixture(), { Host: '127.0.0.1:3210', Origin: 'http://localhost:3210' }))).status).toBe(403);
    expect((await POST(request(requestFixture(), { Host: '127.0.0.1:9999', Origin: 'http://127.0.0.1:9999' }))).status).toBe(403);
    expect((await POST(request(requestFixture(), { Host: 'evil.example:3210', Origin: 'http://evil.example:3210' }))).status).toBe(403);
  });
  it('capabilities disclose availability but never keys or endpoints', async () => {
    vi.stubEnv('AGENT_API_KEY', 'secret-fixture'); vi.stubEnv('MINIMAX_API_KEY', 'mini-secret');
    const res = await GET(new Request('http://localhost:3210/api/capabilities')); const str = await res.text();
    expect(str).not.toContain('secret-fixture'); expect(str).not.toContain('mini-secret'); expect(str).not.toContain('3425');
  });
  it('has finite concurrency and hourly/minute budgets with idempotent release', () => {
    const a = acquireBudget('x',1000), b = acquireBudget('x',1000), c = acquireBudget('x',1000);
    expect(() => acquireBudget('x',1000)).toThrow(); a();a();b();c();
    for (let n=0;n<27;n++) acquireBudget('x',1000)();
    expect(() => acquireBudget('x',1000)).toThrow(); expect(() => acquireBudget('x',62000)()).not.toThrow();
  });
  it('rejects unsupported audio before reaching provider', async () => {
    const form = new FormData(); form.append('requestId','request_audio'); form.append('file',new File(['x'.repeat(100)],'file.txt',{type:'text/plain'}));
    vi.stubEnv('ASR_PROVIDER','minimax'); vi.stubEnv('MINIMAX_API_KEY','test');
    const res = await ASR(new Request('http://localhost:3210/api/speech/transcribe',{method:'POST',body:form})); expect(res.status).toBe(415);
  });
});
describe('real provider candidates', () => {
  function setup() { vi.stubEnv('AGENT_API_KEY','test-key'); vi.stubEnv('AGENT_PROTOCOL','anthropic'); }
  function modelOutput() { const c=mockCandidate(requestFixture()); return { assistantText:c.assistantText, findings:c.findings.map(({validity:_,...f})=>f), card:{type:c.cardDraft!.type,title:c.cardDraft!.title,sections:c.cardDraft!.sections},warnings:[] }; }
  const upstream = (payload: unknown) => Response.json({content:[{type:'text',text:JSON.stringify(payload)}]});
  it('stamps metadata and validates exact source quotations', async () => {
    setup(); const fetcher=vi.fn(async()=>upstream(modelOutput())); const c=await new RealProvider(fetcher).generate(requestFixture(),new AbortController().signal);
    expect(c.serviceMode).toBe('real'); expect(c.runId).toBe('run_test'); expect(c.findings.every(f=>f.validity==='draft')).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('repairs structure at most once and never publishes fabricated evidence', async () => {
    setup(); const bad=modelOutput();bad.findings[0].evidenceRefs[0].quote='从未提供的项目成果';
    const fetcher=vi.fn(async()=>upstream(bad)); await expect(new RealProvider(fetcher).generate(requestFixture(),new AbortController().signal)).rejects.toMatchObject({code:'EVIDENCE_MISMATCH'});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('blocks model-supplied storage instructions', async () => {
    setup(); const fetcher=vi.fn(async()=>upstream({...modelOutput(),saveToCloud:true}));await expect(new RealProvider(fetcher).generate(requestFixture(),new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not blindly retry ambiguous provider/network failures', async () => {
    setup(); const fetcher=vi.fn(async()=>new Response('private echo body',{status:503}));await expect(new RealProvider(fetcher).generate(requestFixture(),new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('narrow urgent-support path stops evaluation without claiming human handover', async () => {
    setup(); const fetcher=vi.fn();const c=await new RealProvider(fetcher).generate(requestFixture({userMessage:'我现在准备伤害自己'}),new AbortController().signal);
    expect(c.supportGuidance).toBe(true);expect(c.findings).toEqual([]);expect(c.cardDraft).toBeUndefined();expect(fetcher).not.toHaveBeenCalled();expect(c.assistantText).toContain('无法提供现场救援');
    expect(needsImmediateSupport('我没有准备伤害自己')).toBe(false);
  });
});
describe('MiniMax adapter', () => {
  it('validates vendor success, decodes hex and retains preset voice', async () => {
    vi.stubEnv('TTS_PROVIDER','minimax');vi.stubEnv('MINIMAX_API_KEY','test');vi.stubEnv('MINIMAX_VOICE_ID','Chinese (Mandarin)_Warm_Bestie');
    const fetcher=vi.fn(async(_url: RequestInfo | URL, options?:RequestInit)=>{const payload=JSON.parse(options!.body as string);expect(payload.voice_setting.voice_id).toBe('Chinese (Mandarin)_Warm_Bestie');expect(options!.redirect).toBe('error');return Response.json({base_resp:{status_code:0},data:{status:2,audio:'49443300'}});});
    expect(await synthesize('你好',new AbortController().signal,fetcher)).toEqual(new Uint8Array([73,68,51,0]));
  });
  it('does not mistake a 200 error payload for usable speech', async () => {
    vi.stubEnv('TTS_PROVIDER','minimax');vi.stubEnv('MINIMAX_API_KEY','test');
    await expect(synthesize('你好',new AbortController().signal,async()=>Response.json({base_resp:{status_code:1004,status_msg:'secret body'}}))).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  });
  it('passes an authorized file via multipart and returns only draft text', async () => {
    vi.stubEnv('ASR_PROVIDER','minimax');vi.stubEnv('MINIMAX_API_KEY','test');
    const fetcher=vi.fn(async(_url:RequestInfo|URL,opts?:RequestInit)=>{expect(opts!.body).toBeInstanceOf(FormData);return Response.json({text:'待核对的原话',duration:2});});
    expect(await transcribe(new File([encodeWav(new Float32Array(16000))],'recording.wav',{type:'audio/wav'}),new AbortController().signal,fetcher)).toBe('待核对的原话');
  });
  it('rejects forged WAV headers and excessive duration before a paid call', async () => {
    vi.stubEnv('ASR_PROVIDER','minimax');vi.stubEnv('MINIMAX_API_KEY','test');const fetcher=vi.fn();
    await expect(transcribe(new File(['x'.repeat(100)],'f.wav',{type:'audio/wav'}),new AbortController().signal,fetcher)).rejects.toMatchObject({code:'UNSUPPORTED_MEDIA'});
    await expect(transcribe(new File([encodeWav(new Float32Array(16000*66))],'f.wav',{type:'audio/wav'}),new AbortController().signal,fetcher)).rejects.toMatchObject({code:'UNSUPPORTED_MEDIA'});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
