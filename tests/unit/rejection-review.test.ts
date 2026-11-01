import { afterEach, expect, it, vi } from 'vitest';
import { RealProvider } from '@/server/providers/real-agent';
import { correctionFallback } from '@/server/providers/rejection-review';
import { requestFixture } from '@/fixtures/scenarios';
import { mockCandidate } from '@/server/providers/mock-agent';
import { validateCandidate } from '@/domain/evidence';

afterEach(() => vi.unstubAllEnvs());
function setup() { vi.stubEnv('AGENT_API_KEY','test-key');vi.stubEnv('AGENT_PROTOCOL','openai');vi.stubEnv('AGENT_COMPANION_MODEL','');vi.stubEnv('AGENT_CALL_MODEL',''); }
function model() { const c=mockCandidate(requestFixture());return {assistantText:'先看这段原话。',findings:c.findings.map(({validity:_,...f})=>f),card:{type:c.cardDraft!.type,title:c.cardDraft!.title,sections:c.cardDraft!.sections}}; }
function upstream(body:unknown) {return Response.json({choices:[{message:{content:JSON.stringify(body)}}]});}
function input() {const r=requestFixture();r.context.rejectedFindings=[{text:'你整体能力不足。',mode:'review',sources:[],needsAcknowledgement:false}];return r;}
it.each([false, 'invalid'])('repairs once then uses grounded fallback when the correction audit returns %s', async verdict=>{
  setup();let calls=0;const fetcher=vi.fn(async (_url:RequestInfo|URL,init?:RequestInit)=>{
    const body=JSON.parse(init!.body as string);expect(init?.signal).toBeDefined();expect(init?.redirect).toBe('manual');calls++;
    if(body.max_tokens===128) return upstream(verdict==='invalid'?{consistent:'true'}:{consistent:false});
    return upstream(model());
  });
  const result=await new RealProvider(fetcher).generate(input(),new AbortController().signal);
  expect(calls).toBe(4);expect(result.cardDraft?.title).toBe('先保留原话与未知');expect(validateCandidate(result,input())).toEqual([]);
  expect(result.findings.every(f=>['reported_fact','unknown'].includes(f.kind))).toBe(true);
});
it('accepts a clean candidate after one audit and does not audit ordinary chat',async()=>{
  setup();const fetcher=vi.fn(async(_url,init)=>{const body=JSON.parse(init!.body as string);return upstream(body.max_tokens===128?{consistent:true}:model());});
  await new RealProvider(fetcher).generate(input(),new AbortController().signal);expect(fetcher).toHaveBeenCalledTimes(2);
  const plain=vi.fn(async()=>upstream({assistantText:'今晚先不分析。',findings:[]}));
  await new RealProvider(plain).generate({...input(),mode:'listen'},new AbortController().signal);expect(plain).toHaveBeenCalledTimes(1);
});
it('audit network failure surfaces a retryable error without claiming a checked response',async()=>{
  setup();const fetcher=vi.fn(async(_url,init)=>JSON.parse(init!.body as string).max_tokens===128?new Response('',{status:503}):upstream(model()));
  await expect(new RealProvider(fetcher).generate(input(),new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('practice fallback changes to an open question instead of reusing the disputed improvement',()=>{
  const request={...input(),mode:'practice' as const};const fallback=correctionFallback(request);
  expect(validateCandidate(fallback,request)).toEqual([]);expect(fallback.practiceSetup?.question).toContain('实际做过');expect(fallback.findings).toEqual([]);
});
