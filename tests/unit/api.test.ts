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
  it('lets the agent prepare a question without inventing an answer or changing other modes', async () => {
    setup(); const payload={assistantText:'就练这一点：你怎么判断画对了？',findings:[],practiceSetup:{question:'你怎么判断画对了？',criteria:['判断标准是否明确']}};
    const fetcher=vi.fn(async()=>upstream(payload));
    const c=await new RealProvider(fetcher).generate(requestFixture({mode:'practice'}),new AbortController().signal);
    expect(c.practiceSetup?.question).toBe(payload.practiceSetup.question);expect(c.cardDraft).toBeUndefined();
    await expect(new RealProvider(fetcher).generate(requestFixture({mode:'listen'}),new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});
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
  it('uses a receiver-free fetch and rejects redirects without following credentials or retrying', async () => {
    setup();
    const fetcher=vi.fn(async function(this: unknown, _url: RequestInfo | URL, init?: RequestInit) {
      expect(this).toBeUndefined(); expect(init?.redirect).toBe('manual');
      return new Response(null,{status:302,headers:{Location:'https://untrusted.example/collect'}});
    });
    await expect(new RealProvider(fetcher).generate(requestFixture(),new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('repairs a verbose call reply once and applies the voice style at the provider boundary', async () => {
    setup(); const input=requestFixture({mode:'listen',channel:'call'});
    const fetcher=vi.fn().mockResolvedValueOnce(upstream({assistantText:'字'.repeat(101),findings:[],warnings:[]})).mockResolvedValueOnce(upstream({assistantText:'先不急着想清楚，慢慢说。',findings:[],warnings:[]}));
    const c=await new RealProvider(fetcher).generate(input,new AbortController().signal);
    expect(c.assistantText).toBe('先不急着想清楚，慢慢说。');expect(fetcher).toHaveBeenCalledTimes(2);
    const body=JSON.parse(fetcher.mock.calls[1][1].body);expect(body.system).toMatch(/(?:这是|当前是)电话/);expect(body.system).toContain('STYLE_LENGTH_MAX_100');
  });
  it('will not publish an explicit false-human claim even if the model repeats it', async () => {
    setup();const fetcher=vi.fn(async()=>upstream({assistantText:'我是真人。',findings:[],warnings:[]}));
    await expect(new RealProvider(fetcher).generate(requestFixture({mode:'listen'}),new AbortController().signal)).rejects.toMatchObject({code:'INVALID_MODEL_OUTPUT'});expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('routes companionship independently while keeping the evidence model for review',async()=>{
    setup();vi.stubEnv('AGENT_MODEL','analysis-fixture');vi.stubEnv('AGENT_COMPANION_MODEL','companion-fixture');vi.stubEnv('AGENT_COMPANION_PROTOCOL','openai');
    const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(init!.body as string);
      if(String(url).endsWith('/chat/completions')){expect(body.model).toBe('companion-fixture');return Response.json({choices:[{message:{content:JSON.stringify({assistantText:'可以，我们慢慢说。',findings:[]})}}]});}
      expect(body.model).toBe('analysis-fixture');return upstream(modelOutput());
    });
    await new RealProvider(fetcher).generate(requestFixture({mode:'listen'}),new AbortController().signal);
    await new RealProvider(fetcher).generate(requestFixture(),new AbortController().signal);expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('narrow urgent-support path stops evaluation without claiming human handover', async () => {
    setup(); const fetcher=vi.fn();const c=await new RealProvider(fetcher).generate(requestFixture({userMessage:'我现在准备伤害自己'}),new AbortController().signal);
    expect(c.supportGuidance).toBe(true);expect(c.findings).toEqual([]);expect(c.cardDraft).toBeUndefined();expect(fetcher).not.toHaveBeenCalled();expect(c.assistantText).toContain('无法提供现场救援');
    expect(needsImmediateSupport('我没有准备伤害自己')).toBe(false);
  });
  it('uses the fast route only for phone listening and removes the duplicated current utterance', async() => {
    setup(); vi.stubEnv('AGENT_CALL_MODEL','phone-fixture'); vi.stubEnv('AGENT_CALL_PROTOCOL','anthropic'); vi.stubEnv('AGENT_COMPANION_MODEL','text-fixture'); vi.stubEnv('AGENT_COMPANION_PROTOCOL','anthropic');
    const input=requestFixture({mode:'listen',channel:'call'}); input.context.recentMessages=[{role:'user',text:'上一句。'},{role:'assistant',text:'接话。'},{role:'user',text:input.userMessage}];
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      const body=JSON.parse(init!.body as string),data=JSON.parse(body.messages[0].content);
      expect(data.recentMessages.at(-1).text).toBe('接话。'); expect(body.max_tokens).toBeLessThanOrEqual(768);
      return upstream({assistantText:'嗯，就聊这个。',findings:[]});
    });
    await new RealProvider(fetcher).generate(input,new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).model).toBe('phone-fixture');
    await new RealProvider(fetcher).generate({...input,channel:'text'},new AbortController().signal);
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).model).toBe('text-fixture');
  });
});
describe('MiniMax adapter', () => {
  it('validates vendor success, decodes hex and retains preset voice', async () => {
    vi.stubEnv('TTS_PROVIDER','minimax');vi.stubEnv('MINIMAX_API_KEY','test');vi.stubEnv('MINIMAX_VOICE_ID','Chinese (Mandarin)_Warm_Bestie');
    const fetcher=vi.fn(async(_url: RequestInfo | URL, options?:RequestInit)=>{const payload=JSON.parse(options!.body as string);expect(payload.voice_setting.voice_id).toBe('Chinese (Mandarin)_Warm_Bestie');expect(options!.redirect).toBe('manual');return Response.json({base_resp:{status_code:0},data:{status:2,audio:'49443300'}});});
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
  it('accepts an empty successful ASR result but rejects malformed and failed provider responses', async()=>{
    vi.stubEnv('ASR_PROVIDER','minimax');vi.stubEnv('MINIMAX_API_KEY','test');
    const file=new File([encodeWav(new Float32Array(16000))],'silence.wav',{type:'audio/wav'});
    const signal=new AbortController().signal;
    expect(await transcribe(file,signal,vi.fn(async()=>Response.json({text:'',duration:1})))).toBe('');
    await expect(transcribe(file,signal,vi.fn(async()=>Response.json({error:'unavailable'})))).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    await expect(transcribe(file,signal,vi.fn(async()=>new Response('',{status:503})))).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  });
  it('rejects ASR and TTS redirects without following the audio or text to another host', async () => {
    vi.stubEnv('ASR_PROVIDER','minimax');vi.stubEnv('TTS_PROVIDER','minimax');vi.stubEnv('MINIMAX_API_KEY','test');
    const fetcher=vi.fn(async function(this: unknown, _url: RequestInfo | URL, init?: RequestInit) {
      expect(this).toBeUndefined();expect(init?.redirect).toBe('manual');
      return new Response(null,{status:307,headers:{Location:'https://untrusted.example/collect'}});
    });
    const signal=new AbortController().signal;
    await expect(synthesize('合成测试',signal,fetcher)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    await expect(transcribe(new File([encodeWav(new Float32Array(16000))],'synthetic.wav',{type:'audio/wav'}),signal,fetcher)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects forged WAV headers and excessive duration before a paid call', async () => {
    vi.stubEnv('ASR_PROVIDER','minimax');vi.stubEnv('MINIMAX_API_KEY','test');const fetcher=vi.fn();
    await expect(transcribe(new File(['x'.repeat(100)],'f.wav',{type:'audio/wav'}),new AbortController().signal,fetcher)).rejects.toMatchObject({code:'UNSUPPORTED_MEDIA'});
    await expect(transcribe(new File([encodeWav(new Float32Array(16000*66))],'f.wav',{type:'audio/wav'}),new AbortController().signal,fetcher)).rejects.toMatchObject({code:'UNSUPPORTED_MEDIA'});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
