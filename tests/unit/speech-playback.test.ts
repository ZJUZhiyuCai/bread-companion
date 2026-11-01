import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BreadController } from '@/services/bread-controller';
import { getCapabilities } from '@/server/config';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const controllers: BreadController[] = [];
afterEach(() => { controllers.splice(0).forEach(c => c.dispose()); vi.unstubAllGlobals(); });

async function setup() {
  const synthesis = deferred<Response>();
  class AudioFake {
    ready = deferred<void>();
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn(() => this.ready.promise);
    pause = vi.fn(); removeAttribute = vi.fn(); load = vi.fn();
    constructor() { audio.push(this); }
  }
  const audio: AudioFake[] = [];
  vi.stubGlobal('Audio', AudioFake);
  const caps = getCapabilities(); caps.tts.available = true;
  const c = new BreadController(async url => String(url).endsWith('/capabilities') ? Response.json(caps) : synthesis.promise);
  controllers.push(c); await c.initialize(); c.start('listen', true);
  const text = c.getSnapshot().state.messages[0].text;
  return { c, audio, synthesis, text, release: () => synthesis.resolve(new Response(new Blob(['fixture audio']))) };
}

describe('expression follows actual text playback', () => {
  it('stays quiet through synthesis and the browser play gate, then stops at the end', async () => {
    const h = await setup(); const pending = h.c.speak(h.text);
    expect(h.c.getSnapshot().state.activity).toBe('preparing_speech');
    expect(h.audio).toHaveLength(0);
    h.release(); await vi.waitFor(() => expect(h.audio).toHaveLength(1));
    expect(h.audio).toHaveLength(1);
    expect(h.c.getSnapshot().state.activity).toBe('preparing_speech');
    h.audio[0].ready.resolve(); await tick();
    expect(h.c.getSnapshot().state.activity).toBe('speaking');
    h.audio[0].onended?.(); await pending;
    expect(h.c.getSnapshot().state.activity).toBe('idle');
  });

  it('switching away during synthesis cannot start delayed speech in the background', async () => {
    const h = await setup(); const pending = h.c.speak(h.text);
    h.c.pauseForBackground(); h.release(); await pending;
    expect(h.audio).toHaveLength(0);
    expect(h.c.getSnapshot().state.activity).toBe('paused');
  });

  it('stopping while the browser is preparing audio prevents a late speaking state', async () => {
    const h = await setup(); const pending = h.c.speak(h.text);
    h.release(); await vi.waitFor(() => expect(h.audio).toHaveLength(1)); h.c.stop();
    h.audio[0].ready.resolve(); await pending;
    expect(h.audio[0].pause).toHaveBeenCalled();
    expect(h.c.getSnapshot().state.activity).toBe('paused');
  });

  it('a rejected browser playback reports an error without ever animating speech', async () => {
    const h = await setup(); const states: string[] = [];
    const unsubscribe = h.c.subscribe(() => states.push(h.c.getSnapshot().state.activity));
    const pending = h.c.speak(h.text); h.release(); await vi.waitFor(() => expect(h.audio).toHaveLength(1));
    h.audio[0].ready.reject(new Error('Playback blocked')); await pending; unsubscribe();
    expect(states).not.toContain('speaking');
    expect(h.c.getSnapshot().state.activity).toBe('error');
  });
});
