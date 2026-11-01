import { test, expect, type Page } from '@playwright/test';
import { encodeWav } from '../../services/media-controller';
import { readFileSync } from 'node:fs';

// A controllable microphone connected to the actual browser AudioWorklet. Provider I/O is mocked
// here; the separate opt-in live check measures MiniMax + the configured model end to end.
async function setup(page: Page, hold: 'asr' | 'model' | '' = '') {
  const stats = { asr: [] as ArrayBuffer[], turns: [] as any[], tts: 0, release: () => {} };
  const held = new Promise<void>(r => { stats.release = r; });
  await page.addInitScript(({ voice }) => {
    const w = window as any;
    w.__audio = { inputs: [], stops: [], plays: [], tracks: [] };
    const Context = window.AudioContext;
    window.AudioContext = class extends Context { constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); w.__context = this; } };
    const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function(...args) {
      if (!(this as any).__input) { w.__playback = { node: this, at: this.context.currentTime }; w.__audio.plays.push(performance.now()); }
      return start.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function(...args) { if (!(this as any).__input) w.__audio.stops.push(performance.now()); return stop.apply(this, args); };
    navigator.mediaDevices.getUserMedia = async() => {
      const c = w.__context as AudioContext, dest = c.createMediaStreamDestination(); w.__dest = dest;
      w.__audio.tracks.push(...dest.stream.getTracks());
      const bytes = Uint8Array.from(atob(voice), n => n.charCodeAt(0));
      const speech = await c.decodeAudioData(bytes.buffer);
      w.__emit = (kind: 'speech' | 'noise' | 'echo') => {
        const src = c.createBufferSource(); (src as any).__input = true;
        const gain = c.createGain(); gain.connect(dest); src.connect(gain); let offset = 0;
        if (kind === 'echo') {
          src.buffer = w.__playback.node.buffer; gain.gain.value = .6;
          offset = Math.max(0, c.currentTime - w.__playback.at - .063);
        } else if (kind === 'noise') {
          src.buffer = c.createBuffer(1, c.sampleRate / 2, c.sampleRate);
          const a = src.buffer.getChannelData(0); for (let i = 0; i < a.length; i++) a[i] = i % 2 ? .1 : -.1;
        } else {
          // Distinct 80 ms onset marker: it disappears if capture restarts at the 160 ms decision.
          src.buffer = c.createBuffer(1, speech.length, speech.sampleRate); src.buffer.copyToChannel(speech.getChannelData(0).map(v => v * .2), 0);
          const a = src.buffer.getChannelData(0); for (let i = 0; i < speech.sampleRate * .08; i++) a[i] = .7 * Math.sin(i * 2 * Math.PI * 800 / speech.sampleRate);
        }
        const at = c.currentTime + .02; src.start(at, offset); w.__audio.inputs.push({ kind, at: performance.now() + 20, duration: src.buffer!.duration });
        return src.buffer!.duration;
      };
      return dest.stream;
    };
  }, { voice: readFileSync('tests/fixtures/voice-input.wav').toString('base64') });
  await page.route('**/api/capabilities', async r => { const res = await r.fetch(), c = await res.json(); c.asr.available = c.tts.available = true; await r.fulfill({ json: c }); });
  await page.route('**/api/speech/transcribe', async r => {
    const req = new Request('http://localhost/', { method: 'POST', headers: { 'Content-Type': r.request().headers()['content-type'] }, body: new Uint8Array(r.request().postDataBuffer()!) });
    const form = await req.formData(), buffer = await (form.get('file') as File).arrayBuffer(); stats.asr.push(buffer); const n = stats.asr.length;
    if (hold === 'asr' && n === 1) await held;
    await r.fulfill({ json: { requestId: form.get('requestId'), text: n === 1 ? '今天有点累，先别给我建议。' : '等一下，我其实想说刚买的猫咪贴纸。', confirmed: false } }).catch(() => {});
  });
  await page.route('**/api/agent/turn', async r => { stats.turns.push(r.request().postDataJSON()); if (hold === 'model' && stats.turns.length === 1) await held; await r.continue().catch(() => {}); });
  await page.route('**/api/speech/synthesize', async r => {
    stats.tts++; const n = 16000 * (stats.tts === 1 ? .2 : 8);
    const tone = Float32Array.from({ length: n }, (_, i) => .06 * Math.sin(i * 2 * Math.PI * 213 / 16000) + .025 * Math.sin(i * 2 * Math.PI * 573 / 16000));
    await r.fulfill({ body: Buffer.from(encodeWav(tone)), contentType: 'audio/wav' });
  });
  await page.goto('/'); await page.getByRole('button', { name: /给面包打个电话/ }).click();
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'listening');
  return stats;
}
const speak = (page: Page, kind = 'speech') => page.evaluate(k => (window as any).__emit(k), kind);
const phase = (page: Page, name: string) => expect(page.locator('.callroom')).toHaveAttribute('data-phase', name, { timeout: 12000 });
const hangup = async(page: Page) => { await page.getByRole('button', { name: '挂断', exact: true }).click(); expect(await page.evaluate(() => (window as any).__audio.tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true); };

test('speech alone cuts playback; echo and hiss do not, and the first 80 ms survive capture', async({ page }) => {
  const stats = await setup(page); await speak(page); await phase(page, 'speaking');
  await speak(page, 'echo'); await speak(page, 'noise'); await page.waitForTimeout(650);
  await phase(page, 'speaking'); expect(stats.asr).toHaveLength(1);
  await speak(page); await phase(page, 'listening');
  await expect(page.locator('.callroom')).toHaveClass(/is-caught/);
  await expect(page.locator('.callroom__cue')).toHaveCount(0);
  const timing = await page.evaluate(() => (window as any).__audio);
  const onset = timing.inputs.filter((v: any) => v.kind === 'speech').at(-1).at;
  expect(timing.stops.at(-1) - onset).toBeGreaterThan(0); expect(timing.stops.at(-1) - onset).toBeLessThan(500);
  await expect.poll(() => stats.asr.length, { timeout: 12000 }).toBe(2);
  await expect(page.locator('.callroom')).not.toHaveClass(/is-caught/);
  const wave = new DataView(stats.asr[1]); let peak = 0; for (let i = 44; i < wave.byteLength; i += 2) peak = Math.max(peak, Math.abs(wave.getInt16(i, true)) / 32768);
  expect(peak).toBeGreaterThan(.5); await hangup(page);
});

test('resuming speech during ASR sends the joined sentence and never publishes the canceled prefix', async({ page }) => {
  const stats = await setup(page, 'asr'); await speak(page); await phase(page, 'transcribing');
  await speak(page); await phase(page, 'listening');
  await expect.poll(() => stats.asr.length, { timeout: 12000 }).toBe(2); stats.release(); await phase(page, 'speaking');
  expect(stats.asr[1].byteLength).toBeGreaterThan(stats.asr[0].byteLength * 1.7); expect(stats.turns).toHaveLength(1);
  expect(stats.turns[0].userMessage).toContain('猫咪贴纸'); await hangup(page);
});

test('a new voice turn cancels a pending model and mute really disables the track', async({ page }) => {
  const stats = await setup(page, 'model'); await speak(page); await phase(page, 'thinking');
  await page.getByRole('button', { name: '静音', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__audio.tracks.every((t: MediaStreamTrack) => !t.enabled))).toBe(true);
  await page.getByRole('button', { name: '静音', exact: true }).click();
  await speak(page); await phase(page, 'listening'); stats.release();
  await expect.poll(() => stats.turns.length, { timeout: 12000 }).toBe(2); await phase(page, 'speaking');
  expect(stats.tts).toBe(2); await hangup(page);
});

test('mobile detects a muted microphone and reconnects to a new working capture', async({page}) => {
  await page.setViewportSize({width:390,height:844});
  const stats=await setup(page);
  await page.evaluate(() => { for(const t of (window as any).__audio.tracks) Object.defineProperty(t,'muted',{configurable:true,get:()=>true}); });
  await phase(page,'error');
  await expect(page.locator('.callroom').getByRole('alert')).toContainText('麦克风被浏览器暂停');
  expect(stats.asr).toHaveLength(0);
  await page.getByRole('button',{name:'再试一次',exact:true}).click();await phase(page,'listening');
  await speak(page);await expect.poll(()=>stats.asr.length,{timeout:12000}).toBe(1);
  await page.getByRole('button',{name:'挂断，改成打字',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'写给面包',exact:true})).toBeVisible();
});

test('mobile shows digital silence and offers reconnection without claiming speech or billing ASR', async({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>Object.defineProperty(navigator,'userAgent',{get:()=> 'Mozilla HarmonyOS MicroMessenger/8.0'}));
  const stats=await setup(page);
  await expect(page.getByRole('status').filter({hasText:'还没收到声音'})).toBeVisible({timeout:12000});
  await expect(page.getByRole('status').filter({hasText:'还没收到声音'})).toContainText('在微信右上角');
  await phase(page,'listening');expect(stats.asr).toHaveLength(0);
  await page.getByRole('button',{name:'重新连接麦克风',exact:true}).click();await phase(page,'listening');
  await speak(page);await expect.poll(()=>stats.asr.length,{timeout:12000}).toBe(1);
  await hangup(page);
});

test('mobile detects a stalled worklet instead of silently waiting forever', async({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{
    const Node=window.AudioWorkletNode;
    window.AudioWorkletNode=class extends Node {constructor(...args:ConstructorParameters<typeof AudioWorkletNode>){super(...args);(window as any).__capture=this;}};
  });
  const stats=await setup(page);
  await page.evaluate(()=>{(window as any).__capture.port.onmessage=null;});
  await phase(page,'error');await expect(page.locator('.callroom').getByRole('alert')).toContainText('没有收到麦克风声音');
  expect(stats.asr).toHaveLength(0);await hangup(page);
});
