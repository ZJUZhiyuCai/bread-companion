import {afterEach,expect,it,vi} from 'vitest';
import {RealProvider} from '@/server/providers/real-agent';
import {requestFixture} from '@/fixtures/scenarios';
const content={assistantText:'面试不太顺啊。',findings:[],warnings:[],supportGuidance:false};
afterEach(()=>vi.unstubAllEnvs());
function setup(){
 vi.stubEnv('AGENT_API_KEY','analysis-test-key');vi.stubEnv('AGENT_BASE_URL','https://analysis.example/v1');vi.stubEnv('AGENT_PROTOCOL','anthropic');
 vi.stubEnv('AGENT_COMPANION_BASE_URL','https://companion.example/v1');vi.stubEnv('AGENT_COMPANION_API_KEY','companion-test-key');vi.stubEnv('AGENT_COMPANION_MODEL','seed-2.1-pro');vi.stubEnv('AGENT_CALL_MODEL','');vi.stubEnv('AGENT_COMPANION_PROTOCOL','openai');vi.stubEnv('AGENT_COMPANION_REASONING_EFFORT','minimal');
}
it('isolates the companion credential and uses the explicitly selected thinking effort for text and phone',async()=>{
 setup();const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]})));
 for(const channel of ['text','call'] as const)await new RealProvider(fetcher).generate(requestFixture({mode:'listen',channel}),new AbortController().signal);
 for(const [url,init] of fetcher.mock.calls as unknown as [string,RequestInit][]){
 expect(url).toBe('https://companion.example/v1/chat/completions');expect(init.headers).toMatchObject({Authorization:'Bearer companion-test-key'});
 expect(JSON.parse(init.body as string)).toMatchObject({model:'seed-2.1-pro',thinking:{type:'enabled'},reasoning_effort:'minimal'});
 }
});
it('never falls back to sending the analysis key to a separate companion host',async()=>{
 setup();vi.stubEnv('AGENT_COMPANION_API_KEY','');const fetcher=vi.fn();await expect(new RealProvider(fetcher).generate(requestFixture({mode:'listen'}),new AbortController().signal)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(fetcher).not.toHaveBeenCalled();
});
it('keeps analysis at its original endpoint and credential with no companion reasoning override',async()=>{
 setup();const fetcher=vi.fn(async()=>new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(content)}]})));
 await new RealProvider(fetcher).generate(requestFixture({mode:'organize'}),new AbortController().signal);
 const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://analysis.example/v1/messages');expect(init.headers).toMatchObject({Authorization:'Bearer analysis-test-key'});expect(JSON.parse(init.body as string).thinking).toEqual({type:'disabled'});
});
