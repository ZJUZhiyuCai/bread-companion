import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CALL_GREETING } from '../../domain/call-greeting';

// Explicit software WebGL keeps these failure tests reproducible on CI without a GPU.
// Microphone input below is generated inside Web Audio; no physical device is opened.
test.use({ launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } });

async function instrument(page: Page, fault: 'construct' | 'software' | '' = '') {
  await page.addInitScript(initialFault => {
    const w = window as any;
    const contexts: WebGL2RenderingContext[] = [];
    const tracks: MediaStreamTrack[] = [];
    const audio: AudioContext[] = [];
    w.__phoneFault = initialFault;
    w.__phoneDraws = 0;
    w.__micCalls = 0;
    w.__micResolutions = 0;
    w.__greetingStarts = [];
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
      // Exercise the hardware path on CI's real software WebGL implementation. Only capability
      // selection is substituted; renderer work, faults, disposal and audio are still real.
      if (String(args[0]).startsWith('webgl')) args[1] = { ...args[1], failIfMajorPerformanceCaveat: false };
      const context = (get as any).apply(this, args);
      if (context && String(args[0]).startsWith('webgl') && !contexts.includes(context)) contexts.push(context);
      return context;
    } as any;
    const parameter = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (p: number) {
      const info = this.getExtension('WEBGL_debug_renderer_info');
      if (info && p === info.UNMASKED_RENDERER_WEBGL) {
        return initialFault === 'software' ? 'ANGLE SwiftShader Device' : 'Test hardware capability';
      }
      return parameter.call(this, p);
    };
    for (const name of ['drawElements', 'drawArrays', 'createFramebuffer']) {
      const proto = WebGL2RenderingContext.prototype as any;
      const original = proto[name];
      proto[name] = function (...args: any[]) {
        if ((w.__phoneFault === 'construct' && name === 'createFramebuffer') ||
            (w.__phoneFault === 'draw' && name.startsWith('draw'))) {
          w.__phoneFault = '';
          throw new Error('Injected graphics failure');
        }
        if (name.startsWith('draw')) w.__phoneDraws++;
        return original.apply(this, args);
      };
    }
    const Context = window.AudioContext;
    window.AudioContext = class extends Context {
      constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); audio.push(this); }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      w.__micCalls++;
      if (w.__micGate) { await w.__micGate; w.__micGate = null; }
      const context = new AudioContext();
      const stream = context.createMediaStreamDestination().stream;
      for (const track of stream.getTracks()) {
        tracks.push(track);
        const stop = track.stop.bind(track);
        track.stop = () => { stop(); void context.close(); };
      }
      w.__micResolutions++;
      return stream;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      if (this.buffer && this.buffer.duration > 2) w.__greetingStarts.push(performance.now());
      return start.apply(this, args);
    };
    w.__phoneAudit = () => ({
      contexts: contexts.length,
      liveContexts: contexts.filter(c => !c.isContextLost()).length,
      draws: w.__phoneDraws,
      micCalls: w.__micCalls,
      resolvedMics: w.__micResolutions,
      tracksStopped: tracks.every(t => t.readyState === 'ended'),
      audioClosed: audio.every(c => c.state === 'closed'),
      greetings: w.__greetingStarts.length,
    });
  }, fault);
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch();
    const c = await response.json();
    c.asr.available = c.tts.available = c.agent.configured = true;
    c.tts.greeting = CALL_GREETING.url;
    await route.fulfill({ json: c });
  });
  await page.route('**/api/speech/**', route => route.fulfill({ status: 503, json: { error: { userMessage: 'No cloud calls in a graphics test.' } } }));
}

const audit = (page: Page) => page.evaluate(() => (window as any).__phoneAudit());
const phone = (page: Page) => page.getByRole('button', { name: /给面包打个电话/ });
const canvas = (page: Page) => page.locator('.phone3d[data-state="ready"] canvas');
const poster = (page: Page) => page.locator('.phone-door__poster');
async function expectStaticPhone(page: Page) {
  await expect(poster(page)).toBeVisible();
  await expect.poll(() => poster(page).evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(632);
  await expect(page.locator('.phone-door__phone .rp-shake')).toHaveCSS('opacity', '0');
}
async function home(page: Page, query = '') {
  await page.goto('/' + query);
  // Readiness has an 8 s network deadline, plus initial hydration on the software
  // CI GPU. This is setup for graphics fault tests, not a 5 s startup SLA.
  await expect(phone(page)).not.toHaveAttribute('aria-disabled', 'true', { timeout: 12_000 });
}
async function hangup(page: Page) {
  await page.getByRole('button', { name: '挂断', exact: true }).click();
  await expect(page.locator('.callroom')).toHaveCount(0);
  await expect.poll(async () => (await audit(page)).tracksStopped).toBe(true);
  await expect.poll(async () => (await audit(page)).audioClosed).toBe(true);
  await expect.poll(async () => (await audit(page)).liveContexts).toBe(0);
}

test('a slow model cannot block a call, repeated taps or hangup; a late response cannot resurrect its canvas', async ({ page }) => {
  await instrument(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested = 0;
  await page.route('**/bread-phone.glb', async route => {
    requested++;
    await held;
    await route.fulfill({ body: readFileSync('public/companion/3d/bread-phone.glb'), contentType: 'model/gltf-binary' }).catch(() => {});
  });
  await home(page);
  await expect.poll(() => requested).toBe(1);
  await expectStaticPhone(page);
  await phone(page).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'speaking');
  expect((await audit(page)).micCalls).toBe(1);
  expect((await audit(page)).greetings).toBe(1);
  expect((await audit(page)).contexts).toBe(0);
  await hangup(page);
  release();
  await page.waitForTimeout(400);
  expect((await audit(page)).contexts).toBe(0);
  expect(await page.locator('.phone3d canvas').count()).toBe(0);
});

test('rest, reduced motion and a hidden call stop drawing; hangup releases all graphics and audio', async ({ page }) => {
  // Two real renderer initializations plus animation and cleanup checks on the software CI GPU.
  test.setTimeout(45_000);
  await instrument(page);
  await home(page);
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1800);
  const idle = (await audit(page)).draws;
  await page.waitForTimeout(400);
  expect((await audit(page)).draws).toBe(idle);
  await phone(page).click();
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'speaking');
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.evaluate(() => {
    const w = window as any;
    w.__micGate = new Promise<void>(resolve => { w.__releaseMic = resolve; });
  });
  await page.getByRole('button', { name: '继续通话', exact: true }).click();
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'connecting');
  const active = (await audit(page)).draws;
  await expect.poll(async () => (await audit(page)).draws).toBeGreaterThan(active);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(100);
  const hidden = (await audit(page)).draws;
  await page.waitForTimeout(350);
  expect((await audit(page)).draws).toBe(hidden);
  await page.evaluate(() => { delete (document as any).hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(async () => (await audit(page)).draws).toBeGreaterThan(hidden);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Applying a media-query change includes one final frame for the settled pose. Wait for that
  // asynchronous transition to finish instead of assuming React + the GPU settle within 200 ms.
  await expect.poll(async () => {
    const before = (await audit(page)).draws;
    await page.waitForTimeout(350);
    return (await audit(page)).draws - before;
  }, { timeout: 5000, intervals: [100] }).toBe(0);
  const still = (await audit(page)).draws;
  await page.waitForTimeout(1000);
  expect((await audit(page)).draws).toBe(still);
  await hangup(page);
  await page.evaluate(() => (window as any).__releaseMic());
  await expect.poll(async () => (await audit(page)).resolvedMics).toBe(2);
  await expect.poll(async () => (await audit(page)).tracksStopped).toBe(true);
  await expect.poll(async () => (await audit(page)).audioClosed).toBe(true);
});

for (const fault of ['construct', 'draw', 'context'] as const) {
  test(`a ${fault} graphics failure keeps the same callable phone and releases its context`, async ({ page }) => {
    const errors: Error[] = [];
    page.on('pageerror', e => errors.push(e));
    await instrument(page, fault === 'construct' ? 'construct' : '');
    await home(page);
    if (fault !== 'construct') {
      await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
      if (fault === 'context') {
        await canvas(page).evaluate(el => (el as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!.loseContext());
      } else {
        await page.evaluate(() => { (window as any).__phoneFault = 'draw'; });
        await phone(page).hover();
      }
    }
    await expect.poll(async () => (await audit(page)).contexts, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.locator('.phone-door__art')).not.toHaveClass(/is-3d/);
    await expect.poll(async () => (await audit(page)).liveContexts).toBe(0);
    await expectStaticPhone(page);
    await phone(page).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'speaking');
    await hangup(page);
    expect(errors).toEqual([]);
  });
}

test('static comparison skips the model and WebGL while retaining keyboard calling', async ({ page }) => {
  await instrument(page);
  let greetingRequests = 0;
  await page.route('**/companion/hello-warm-bestie.mp3*', async route => {
    greetingRequests++;
    await route.fulfill({ status: 503, body: 'Opening asset unavailable' });
  });
  let requests = 0;
  page.on('request', request => { if (request.url().includes('.glb')) requests++; });
  await home(page, '?phone=svg');
  await expectStaticPhone(page);
  await phone(page).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'speaking', { timeout: 8000 });
  expect(requests).toBe(0);
  expect(greetingRequests).toBe(0);
  expect((await audit(page)).contexts).toBe(0);
  expect((await audit(page)).greetings).toBe(1);
  await hangup(page);
});

test('a stalled download expires; the next stage retries only after the welcome starts', async ({ page }) => {
  // Includes the actual 10-second download deadline, shader setup and resource-release assertions.
  test.setTimeout(45_000);
  await instrument(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  let aborted = false;
  page.on('requestfailed', request => {
    if (request.url().includes('bread-phone.glb')) aborted = true;
  });
  await page.route('**/bread-phone.glb', async route => {
    requests++;
    await held;
    await route.fulfill({ body: readFileSync('public/companion/3d/bread-phone.glb'), contentType: 'model/gltf-binary' }).catch(() => {});
  });
  await home(page);
  await expect.poll(() => requests).toBe(1);
  await expect.poll(() => aborted, { timeout: 12_000 }).toBe(true);
  await expect(page.locator('.phone3d')).toHaveCount(0);
  await phone(page).click();
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'speaking');
  await expect.poll(() => requests).toBe(2);
  expect((await audit(page)).greetings).toBe(1);
  expect((await audit(page)).contexts).toBe(0);
  release();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await hangup(page);
});

test('software graphics keeps the same phone callable without compiling room shaders', async ({ page }) => {
  await instrument(page, 'software');
  await home(page);
  await expect.poll(async () => (await audit(page)).contexts).toBe(1);
  await expect(page.locator('.phone3d')).toHaveCount(0);
  expect((await audit(page)).liveContexts).toBe(0);
  expect((await audit(page)).draws).toBe(0);
  await expectStaticPhone(page);
  await phone(page).click();
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'speaking');
  expect((await audit(page)).greetings).toBe(1);
  expect((await audit(page)).contexts).toBe(1);
  await hangup(page);
});

test('readiness and model loading keep one red phone, stable bounds and no premature graphics work', async ({ page }) => {
  await instrument(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch();
    const caps = await response.json();
    caps.asr.available = caps.tts.available = caps.agent.configured = true;
    await held;
    await route.fulfill({ json: caps }).catch(() => {});
  });
  await page.goto('/');
  await expect(phone(page)).toHaveAttribute('aria-disabled', 'true');
  await expectStaticPhone(page);
  await expect(page.locator('.phone-door--hero')).not.toHaveClass(/is-blocked/);
  await page.evaluate(() => document.fonts.ready);
  const before = await page.locator('.phone-door__art').boundingBox();
  // Longer than the graphics idle callback's 1.5-second deadline, with the network held independently.
  await page.waitForTimeout(1800);
  expect((await audit(page)).contexts).toBe(0);
  expect((await audit(page)).micCalls).toBe(0);
  release();
  await expect(phone(page)).not.toHaveAttribute('aria-disabled', 'true');
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
  await expect(poster(page)).toBeHidden();
  expect(await page.locator('.phone-door__art').boundingBox()).toEqual(before);
});

test('a corrupt model releases its renderer and retains the static phone', async ({ page }) => {
  await instrument(page);
  await page.route('**/bread-phone.glb', route => route.fulfill({ body: 'corrupt model', contentType: 'model/gltf-binary' }));
  await home(page);
  await expect.poll(async () => (await audit(page)).contexts, { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await audit(page)).liveContexts).toBe(0);
  await expectStaticPhone(page);
  await phone(page).click();
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'speaking');
  expect((await audit(page)).contexts).toBe(1);
  await hangup(page);
});
