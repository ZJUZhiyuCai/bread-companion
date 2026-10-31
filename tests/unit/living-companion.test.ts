import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CALL_GREETING } from '@/domain/call-greeting';
import { farewellReply } from '@/domain/policy';
import { responseStyleErrors } from '@/domain/response-style';
import { requestFixture } from '@/fixtures/scenarios';
import { getCapabilities } from '@/server/config';
import { RealProvider } from '@/server/providers/real-agent';
import { BreadController } from '@/services/bread-controller';
import { CallController } from '@/services/call-controller';
import type { CallAudioEvents, CallAudioPort } from '@/services/call-audio';
import { startDialTone } from '@/services/dial-tone';

const tick = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
};
class AudioFake implements CallAudioPort {
  events!: CallAudioEvents;
  open = vi.fn(async (events: CallAudioEvents) => { this.events = events; return true; });
  listen = vi.fn(); finish = vi.fn(); close = vi.fn(); stopPlayback = vi.fn(); stopDialTone = vi.fn();
  play = vi.fn(async (_blob: Blob, _signal: AbortSignal, onStart: () => void) => { onStart(); });
}
const controllers: BreadController[] = [];
afterEach(() => { controllers.splice(0).forEach(c => c.dispose()); vi.unstubAllEnvs(); });
function caps() {
  const c = getCapabilities();
  c.asr.available = c.tts.available = c.agent.configured = true;
  c.tts.greeting = CALL_GREETING.url;
  return c;
}

describe('a real connection before the welcome', () => {
  it('uses the local opening on every new call and never synthesizes a second opening for a double tap', async () => {
    const requests: string[] = []; const audio = new AudioFake();
    const controller = new BreadController(async url => {
      requests.push(String(url));
      if (String(url).endsWith('/capabilities')) return Response.json(caps());
      if (url === CALL_GREETING.url) return new Response('synthetic fixture', { headers: { 'Content-Type': 'audio/mpeg' } });
      throw new Error('Unexpected paid request');
    }, undefined, audio);
    controllers.push(controller); await controller.initialize();
    const first = controller.startCall(); await controller.startCall(); await first;
    expect(controller.getSnapshot().call.phase).toBe('listening');
    expect(controller.getSnapshot().call.caption).toBe(CALL_GREETING.text);
    expect(audio.play).toHaveBeenCalledTimes(1);
    controller.hangupCall(); await controller.startCall();
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(requests.filter(url => url === CALL_GREETING.url)).toHaveLength(2);
    expect(requests.some(url => url.includes('/synthesize'))).toBe(false);
  });

  it('falls back once to the configured voice when a static opening is missing', async () => {
    const requests: string[] = []; const audio = new AudioFake();
    const controller = new BreadController(async (url, init) => {
      requests.push(String(url));
      if (String(url).endsWith('/capabilities')) return Response.json(caps());
      if (url === CALL_GREETING.url) return new Response('missing', { status: 404 });
      expect(JSON.parse(init!.body as string).text).toBe(CALL_GREETING.text);
      return new Response('synthetic fixture', { headers: { 'Content-Type': 'audio/mpeg' } });
    }, undefined, audio);
    controllers.push(controller); await controller.initialize(); await controller.startCall();
    expect(requests.filter(url => url.includes('/synthesize'))).toHaveLength(1);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('hangup cancels a delayed opening without late sound or a paid fallback', async () => {
    const cached = deferred<Response>(); const audio = new AudioFake(); const paid = vi.fn();
    const controller = new BreadController(async url => {
      if (String(url).endsWith('/capabilities')) return Response.json(caps());
      if (url === CALL_GREETING.url) return cached.promise;
      paid(); throw new Error('Unexpected paid fallback');
    }, undefined, audio);
    controllers.push(controller); await controller.initialize();
    const opening = controller.startCall(); await tick();
    expect(controller.getSnapshot().call.phase).toBe('connecting');
    controller.hangupCall(); cached.resolve(new Response('late', { headers: { 'Content-Type': 'audio/mpeg' } }));
    await opening;
    expect(controller.getSnapshot().call.phase).toBe('idle');
    expect(audio.play).not.toHaveBeenCalled(); expect(paid).not.toHaveBeenCalled();
  });

  it('speaking during opening preparation takes over the microphone and invalidates the late opening', async () => {
    const greeting = deferred<Blob>(); const audio = new AudioFake();
    const controller = new CallController({ update: vi.fn(), cancelReply: vi.fn(), transcribe: vi.fn(), reply: vi.fn(), synthesize: () => greeting.promise }, audio);
    try {
      const opening = controller.start(CALL_GREETING.text); await tick();
      expect(controller.snapshot.phase).toBe('connecting');
      audio.events.speechStart?.();
      expect(controller.snapshot.phase).toBe('listening');
      greeting.resolve(new Blob(['late'])); await opening;
      expect(audio.play).not.toHaveBeenCalled(); expect(controller.snapshot.error).toBe('');
    } finally { controller.hangup(); }
  });

  it('only advertises the recording for its matching voice, model and speed', () => {
    vi.stubEnv('TTS_PROVIDER', 'minimax'); vi.stubEnv('MINIMAX_API_KEY', 'synthetic-test-key');
    vi.stubEnv('MINIMAX_VOICE_ID', CALL_GREETING.voice); vi.stubEnv('MINIMAX_TTS_MODEL', CALL_GREETING.model); vi.stubEnv('MINIMAX_VOICE_SPEED', '1');
    expect(getCapabilities().tts.greeting).toBe(CALL_GREETING.url);
    vi.stubEnv('MINIMAX_VOICE_ID', 'another-configured-voice'); expect(getCapabilities().tts.greeting).toBeUndefined();
    vi.stubEnv('MINIMAX_VOICE_ID', CALL_GREETING.voice); vi.stubEnv('MINIMAX_VOICE_SPEED', '1.2'); expect(getCapabilities().tts.greeting).toBeUndefined();
    vi.stubEnv('MINIMAX_VOICE_SPEED', '1'); vi.stubEnv('MINIMAX_TTS_MODEL', 'another-model'); expect(getCapabilities().tts.greeting).toBeUndefined();
    vi.stubEnv('MINIMAX_TTS_MODEL', CALL_GREETING.model); vi.stubEnv('MINIMAX_API_KEY', ''); expect(getCapabilities().tts.greeting).toBeUndefined();
  });

  it('bounds ringback and disconnects every audio node on cancellation, even if cancelled twice', () => {
    const gain = { connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() } };
    const tones = Array.from({ length: 2 }, () => ({ frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }));
    let index = 0;
    const context = { currentTime: 10, destination: {}, createGain: () => gain, createOscillator: () => tones[index++] } as unknown as AudioContext;
    const stop = startDialTone(context);
    tones.forEach(tone => expect(tone.stop).toHaveBeenCalledWith(14.3));
    stop(); stop();
    tones.forEach(tone => { expect(tone.disconnect).toHaveBeenCalledTimes(1); expect(tone.stop).toHaveBeenCalledTimes(2); });
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('conversation boundaries without a model round trip', () => {
  it.each(['行，我去吃饭了，晚点再说。', '我先出门了，回头聊。', '好的，明天聊！', '晚安。'])('respects direct leave-taking: %s', async userMessage => {
    vi.stubEnv('AGENT_API_KEY', 'synthetic-test-key'); const fetcher = vi.fn();
    const candidate = await new RealProvider(fetcher).generate(requestFixture({ mode: 'listen', userMessage }), new AbortController().signal);
    expect(candidate.assistantText).not.toMatch(/[？?]/);
    expect(candidate.assistantText.length).toBeLessThan(12);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['他说“晚点再说”，我很难受。', '不要只回我晚安。', '你为什么每次都说再见？', '帮我想个办法，晚点聊。', '我明天要跟他说再见。', '如果我说晚安，你会说什么？'])('does not turn a story or request into an exit: %s', text => {
    expect(farewellReply(text)).toBeNull();
  });
  it('rejects burdening the user with the companion’s guilt while allowing a simple apology', () => {
    expect(responseStyleErrors('我还是有点过意不去。', { mode: 'listen' })).toContain('STYLE_NO_EMOTIONAL_OBLIGATION');
    expect(responseStyleErrors('抱歉，刚才理解错了。', { mode: 'listen' })).toEqual([]);
  });
  it('does not let a correction turn into a defensive argument', () => {
    const input = { mode: 'listen' as const, userMessage: '别替我把他判成一个坏朋友。' };
    expect(responseStyleErrors('我没说他是坏朋友，只是那句话很伤人。', input)).toContain('STYLE_NO_DEFENSIVE_CORRECTION');
    expect(responseStyleErrors('是我没说清楚，收回刚才的判断。', input)).toEqual([]);
  });
});
