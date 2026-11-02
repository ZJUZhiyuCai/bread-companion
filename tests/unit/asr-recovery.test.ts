import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transcribe } from '@/server/providers/speech';
import { encodeWav } from '@/services/media-controller';

const clip=()=>new File([encodeWav(new Float32Array(16000).fill(.1))],'synthetic.wav',{type:'audio/wav'});
beforeEach(()=>{vi.stubEnv('ASR_PROVIDER','minimax');vi.stubEnv('MINIMAX_API_KEY','fixture-only');vi.spyOn(console,'warn').mockImplementation(()=>{});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();vi.useRealTimers();});

describe('bounded ASR recovery',()=>{
  it('reuses the same audio after one transient failure and returns exactly one transcript',async()=>{
    const received:Uint8Array[]=[];let n=0;
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      received.push(new Uint8Array(await ((init!.body as FormData).get('file') as File).arrayBuffer()));
      return ++n===1?new Response(null,{status:503}):Response.json({text:'这句还在。',duration:1});
    });
    expect(await transcribe(clip(),new AbortController().signal,fetcher)).toBe('这句还在。');
    expect(fetcher).toHaveBeenCalledTimes(2);expect(received[1]).toEqual(received[0]);
  });
  it('stops after two failed attempts, without an unbounded retry loop',async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:502}));
    await expect(transcribe(clip(),new AbortController().signal,fetcher)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('cancels the backoff on hangup without starting a second provider request',async()=>{
    vi.useFakeTimers();const controller=new AbortController();
    const fetcher=vi.fn(async()=>new Response(null,{status:503}));
    const result=transcribe(clip(),controller.signal,fetcher);const rejected=expect(result).rejects.toMatchObject({name:'AbortError'});
    await vi.advanceTimersByTimeAsync(20);expect(fetcher).toHaveBeenCalledTimes(1);controller.abort();await rejected;
    await vi.advanceTimersByTimeAsync(1000);expect(fetcher).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
  });
  it.each([401,403,429,307])('does not retry an HTTP %i rejection or follow redirects',async status=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response(null,{status,headers:{'Retry-After':'20',Location:'https://untrusted.example'}}));
    await expect(transcribe(clip(),new AbortController().signal,fetcher)).rejects.toMatchObject(status===429?{code:'RATE_LIMITED',retryAfterSeconds:20}:{code:'PROVIDER_UNAVAILABLE',retryable:false});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1]?.redirect).toBe('manual');
  });
  it('does not retry a structured provider rejection and never logs its body',async()=>{
    const fetcher=vi.fn(async()=>Response.json({base_resp:{status_code:1004,status_msg:'private upstream content'}}));
    await expect(transcribe(clip(),new AbortController().signal,fetcher)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE',retryable:false});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const logged=JSON.stringify(vi.mocked(console.warn).mock.calls);expect(logged).toContain('1004');expect(logged).not.toContain('private upstream');expect(logged).not.toContain('fixture-only');
  });
  it('honors a provider cooldown instead of immediately retrying a 503',async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:503,headers:{'Retry-After':'20'}}));
    await expect(transcribe(clip(),new AbortController().signal,fetcher)).rejects.toMatchObject({retryAfterSeconds:20});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('honors a dated provider cooldown without a second billed attempt',async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:503,headers:{'Retry-After':new Date(Date.now()+60000).toUTCString()}}));
    await expect(transcribe(clip(),new AbortController().signal,fetcher)).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('treats an empty successful transcript as silence, not an outage to retry',async()=>{
    const fetcher=vi.fn(async()=>Response.json({text:'',duration:1}));
    expect(await transcribe(clip(),new AbortController().signal,fetcher)).toBe('');expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
