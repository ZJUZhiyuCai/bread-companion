import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallController, type CallDeps } from '@/services/call-controller';
import { BrowserCallAudio, type CallAudioEvents, type CallAudioPort } from '@/services/call-audio';
import { VoiceActivity, resampleMono } from '@/services/voice-activity';
import { BreadController } from '@/services/bread-controller';
import { mockCandidate } from '@/server/providers/mock-agent';
import { getCapabilities } from '@/server/config';
import type { TurnRequest } from '@/domain/types';
import { responseStyleErrors } from '@/domain/response-style';
import { encodeWav } from '@/services/media-controller';

const tick = async () => { for (let i=0; i<16; i++) await Promise.resolve(); };
const deferred = <T,>() => { let resolve!: (v:T)=>void; let reject!: (e:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; };
class AudioFake implements CallAudioPort {
  events!: CallAudioEvents;
  open = vi.fn(async(events:CallAudioEvents)=>{this.events=events;return true;});
  listen = vi.fn(); finish = vi.fn(); close = vi.fn(); stopPlayback = vi.fn();
  play = vi.fn(async(_blob:Blob,_signal:AbortSignal,onStart:()=>void)=>{onStart();});
  say() { this.events.utterance(new File([encodeWav(new Float32Array(16000))],'call.wav',{type:'audio/wav'})); }
}
let active: CallController[]=[];
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{active.forEach(c=>c.hangup());active=[];vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
function harness(overrides: Partial<CallDeps> = {}) {
  const audio=new AudioFake();
  const deps:CallDeps={update:vi.fn(),cancelReply:vi.fn(),transcribe:vi.fn(async()=> '今天有点累。'),reply:vi.fn(async()=> '那就先歇一会儿。'),synthesize:vi.fn(async()=>new Blob(['audio'])),...overrides};
  const call=new CallController(deps,audio);active.push(call);return {call,audio,deps};
}
describe('continuous call ownership',()=>{
  it('runs ASR → reply → actual playback → listening for successive turns',async()=>{
    const {call,audio,deps}=harness();await call.start();expect(call.snapshot.phase).toBe('listening');
    audio.say();expect(call.snapshot.phase).toBe('transcribing');await tick();
    expect(call.snapshot.phase).toBe('listening');expect(call.snapshot.lastHeard).toBe('今天有点累。');expect(call.snapshot.caption).toBe('那就先歇一会儿。');
    expect(audio.play).toHaveBeenCalledTimes(1);audio.say();await tick();expect(deps.reply).toHaveBeenCalledTimes(2);expect(audio.play).toHaveBeenCalledTimes(2);
  });
  it('hangup ignores late ASR even when the request ignores abort',async()=>{
    const late=deferred<string>();const {call,audio,deps}=harness({transcribe:vi.fn(()=>late.promise)});await call.start();audio.say();call.hangup();late.resolve('不该出现');await tick();
    expect(call.snapshot.active).toBe(false);expect(deps.reply).not.toHaveBeenCalled();expect(audio.close).toHaveBeenCalledTimes(1);
  });
  it('interrupt cancels a pending reply and a late result cannot speak',async()=>{
    const late=deferred<string>();const {call,audio,deps}=harness({reply:vi.fn(()=>late.promise)});await call.start();audio.say();await tick();expect(call.snapshot.phase).toBe('thinking');
    call.interrupt();late.resolve('过期的回答');await tick();expect(call.snapshot.phase).toBe('listening');expect(deps.synthesize).not.toHaveBeenCalled();expect(deps.cancelReply).toHaveBeenCalledTimes(1);
  });
  it('hangup during TTS cannot play audio that arrives later',async()=>{
    const late=deferred<Blob>();const {call,audio}=harness({synthesize:vi.fn(()=>late.promise)});await call.start();audio.say();await tick();call.hangup();late.resolve(new Blob(['late']));await tick();expect(audio.play).not.toHaveBeenCalled();expect(call.snapshot.phase).toBe('idle');
  });
  it('late permission does not reopen listening after hangup',async()=>{
    const {call,audio}=harness();const late=deferred<boolean>();audio.open.mockImplementationOnce(events=>{audio.events=events;return late.promise;});
    const opening=call.start();call.hangup();late.resolve(true);await opening;expect(call.snapshot.active).toBe(false);expect(audio.listen).not.toHaveBeenCalledWith(true);
  });
  it('interrupting the greeting cannot turn a new listening turn into an error',async()=>{
    const late=deferred<Blob>();const {call,audio}=harness({synthesize:vi.fn(()=>late.promise)});
    const opening=call.start('想从哪里说起都可以。');await tick();call.interrupt();late.reject(new DOMException('cancel','AbortError'));await opening;
    expect(call.snapshot.phase).toBe('listening');expect(call.snapshot.error).toBe('');expect(audio.play).not.toHaveBeenCalled();
  });
  it('muting prevents input and stays muted when the current reply ends',async()=>{
    const late=deferred<Blob>();const {call,audio,deps}=harness({synthesize:vi.fn(()=>late.promise)});await call.start();call.toggleMute();audio.say();await tick();expect(deps.transcribe).not.toHaveBeenCalled();
    call.toggleMute();audio.say();await tick();call.toggleMute();late.resolve(new Blob(['audio']));await tick();expect(call.snapshot.phase).toBe('muted');expect(call.snapshot.muted).toBe(true);expect(audio.listen).toHaveBeenLastCalledWith(false);
  });
  it('failure closes mic and waits for an explicit resume, with no automatic retry',async()=>{
    const {call,audio,deps}=harness({transcribe:vi.fn(async()=>{throw new Error('转写没接好');})});await call.start();audio.say();await tick();expect(call.snapshot.phase).toBe('error');expect(audio.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(120000);expect(deps.transcribe).toHaveBeenCalledTimes(1);await call.resume();expect(call.snapshot.phase).toBe('listening');expect(audio.open).toHaveBeenCalledTimes(2);
  });
  it('a minute of silence pauses and releases the microphone without billing ASR',async()=>{
    const {call,audio,deps}=harness();await call.start();await vi.advanceTimersByTimeAsync(60000);
    expect(call.snapshot.phase).toBe('paused');expect(audio.close).toHaveBeenCalledTimes(1);expect(deps.transcribe).not.toHaveBeenCalled();
  });
  it('only a listening turn with actual voiced sound can be manually submitted',async()=>{
    const {call,audio}=harness();await call.start();call.finish();expect(audio.finish).not.toHaveBeenCalled();audio.events.meter(.5,true);call.finish();expect(audio.finish).toHaveBeenCalledTimes(1);call.pause();call.finish();expect(audio.finish).toHaveBeenCalledTimes(1);
  });
});
describe('local speech boundaries',()=>{
  const frame=(value:number)=>new Float32Array(320).fill(value);
  it('does not turn silence or short click noise into a paid utterance',()=>{
    const vad=new VoiceActivity(16000);for(let i=0;i<300;i++)expect(vad.push(frame(0)).utterance).toBeNull();
    vad.push(frame(.8));for(let i=0;i<80;i++)expect(vad.push(frame(0)).utterance).toBeNull();expect(vad.finish()).toBeNull();
  });
  it('keeps natural short pauses within a turn and emits only after the long pause',()=>{
    const vad=new VoiceActivity(16000);for(let i=0;i<20;i++)expect(vad.push(frame(.1)).utterance).toBeNull();
    for(let i=0;i<30;i++)expect(vad.push(frame(0)).utterance).toBeNull();for(let i=0;i<20;i++)vad.push(frame(.1));
    let result:Float32Array|null=null;for(let i=0;i<70;i++){const r=vad.push(frame(0));if(r.utterance)result=r.utterance;}
    expect(result).not.toBeNull();expect(result!.length/16000).toBeGreaterThan(1.4);expect(result!.length/16000).toBeLessThan(1.7);expect(vad.finish()).toBeNull();
  });
  it('bounds continuous audio and produces 16 kHz mono PCM from hardware sample rates',()=>{
    const vad=new VoiceActivity(48000,1.3,2);let out:Float32Array|null=null;for(let i=0;i<110&&!out;i++)out=vad.push(new Float32Array(960).fill(.1)).utterance;
    expect(out!.length/48000).toBeLessThanOrEqual(2.04);const normalized=resampleMono(out!,48000);expect(normalized.length).toBe(Math.floor(out!.length/3));
    const wav=new DataView(encodeWav(normalized));expect(wav.getUint32(24,true)).toBe(16000);expect(wav.getUint16(22,true)).toBe(1);
  });
  it('the browser adapter stops a microphone granted after the user hangs up',async()=>{
    const permission=deferred<MediaStream>();const stop=vi.fn();const track={stop};const close=vi.fn(async()=>{});
    vi.stubGlobal('isSecureContext',true);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:()=>permission.promise}});vi.stubGlobal('AudioWorkletNode',class {});
    vi.stubGlobal('AudioContext',class {state='running';resume=async()=>{};close=close;});
    const audio=new BrowserCallAudio();const opening=audio.open({meter:vi.fn(),utterance:vi.fn(),failure:vi.fn()});audio.close();permission.resolve({getTracks:()=>[track]} as unknown as MediaStream);
    expect(await opening).toBe(false);expect(stop).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
  });
});
describe('call and text continuity',()=>{
  it('uses the call style channel, keeps completed text on hangup and closes for background',async()=>{
    vi.useRealTimers();
    const audio=new AudioFake();let request:TurnRequest|undefined;
    const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
      if(String(url).endsWith('/capabilities')){const caps=getCapabilities();caps.asr.available=true;caps.tts.available=true;return Response.json(caps);}
      if(String(url).endsWith('/transcribe'))return Response.json({requestId:(init!.body as FormData).get('requestId'),text:'今天有点累。'});
      if(String(url).endsWith('/synthesize'))return new Response(new Blob(['audio']));
      request=JSON.parse(init!.body as string);return Response.json(mockCandidate(request!));
    });
    const c=new BreadController(fetcher,undefined,audio);await c.initialize();c.start();await c.startCall();audio.say();await tick();
    expect(request?.channel).toBe('call');expect(c.getSnapshot().state.messages.some(m=>m.text==='今天有点累。')).toBe(true);
    c.pauseForBackground();expect(c.getSnapshot().call.phase).toBe('paused');c.hangupCall();expect(c.getSnapshot().state.lifecycle).toBe('active');expect(c.getSnapshot().state.messages.length).toBeGreaterThan(1);
    await c.send('现在打字了。');expect(request?.channel).toBe('text');c.dispose();
  });
  it('hangup invalidates a pending agent response but preserves the utterance already submitted',async()=>{
    vi.useRealTimers();
    const audio=new AudioFake();const late=deferred<Response>();let request!:TurnRequest;
    const c=new BreadController(async(url,init)=>{
      if(String(url).endsWith('/capabilities')){const caps=getCapabilities();caps.asr.available=true;caps.tts.available=true;return Response.json(caps);}
      if(String(url).endsWith('/transcribe'))return Response.json({requestId:(init!.body as FormData).get('requestId'),text:'保留已经说过的话。'});
      if(String(url).endsWith('/synthesize'))return new Response(new Blob(['greeting']));
      request=JSON.parse(init!.body as string);return late.promise;
    },undefined,audio);
    await c.initialize();c.start();await c.startCall();audio.play.mockClear();audio.say();await tick();c.hangupCall();const count=c.getSnapshot().state.messages.length;late.resolve(Response.json(mockCandidate(request)));await tick();
    expect(c.getSnapshot().state.messages.length).toBe(count);expect(c.getSnapshot().state.messages.at(-1)?.role).toBe('user');expect(audio.play).not.toHaveBeenCalled();c.dispose();
  });
});
describe('observable response style constraints',()=>{
  it('separates a short voice turn from longer written explanation without truncating text',()=>{
    const text='字'.repeat(101);expect(responseStyleErrors(text,{mode:'listen',channel:'call'})).toContain('STYLE_LENGTH_MAX_100');expect(responseStyleErrors(text,{mode:'listen',channel:'text'})).toEqual([]);
    expect(responseStyleErrors('先联系身边可信任的人。'.repeat(10),{mode:'listen',channel:'call'},true)).toEqual([]);
  });
  it('rejects multiple questions, spoken markdown, stage directions and explicit false claims',()=>{
    for(const text of ['哪一次？什么时候？','**很棒**','（叹气）好吧。','我会永远只陪着你。','我是真人。'])expect(responseStyleErrors(text,{mode:'listen',channel:'call'}).length).toBeGreaterThan(0);
    expect(responseStyleErrors('我不是你现实中的朋友，也不能替代他们。但这会儿你想说的，我会认真听。',{mode:'listen',channel:'call'})).toEqual([]);
  });
});
