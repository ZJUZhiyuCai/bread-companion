import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { encodeWav } from '../../services/media-controller';
import { CALL_GREETING } from '../../domain/call-greeting';

const silentInput = resolve('.local/test-living-silence.wav');
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${silentInput}`] } });
test.beforeAll(() => {
  mkdirSync('.local', { recursive: true });
  writeFileSync(silentInput, Buffer.from(encodeWav(new Float32Array(16000 * 12))));
});

async function setup(page: Page) {
  const stats = { syntheses: 0, transcripts: 0 };
  await page.addInitScript(() => {
    (window as any).__openingStarts = [];
    (window as any).__openingTracks = [];
    (window as any).__openingContexts = [];
    const media = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await media(constraints);
      (window as any).__openingTracks.push(...stream.getTracks());
      return stream;
    };
    const resume = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () {
      if (!(window as any).__openingContexts.includes(this)) (window as any).__openingContexts.push(this);
      return resume.call(this);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      (window as any).__openingStarts.push({ at: performance.now(), duration: this.buffer?.duration });
      return start.apply(this, args);
    };
  });
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch(), c = await response.json();
    c.asr.available = c.tts.available = c.agent.configured = true;
    c.tts.greeting = CALL_GREETING.url;
    await route.fulfill({ json: c });
  });
  await page.route('**/api/speech/synthesize', async route => {
    stats.syntheses++;
    await route.fulfill({ status: 503, json: { error: { userMessage: 'Unexpected synthesis in a cached-opening test.' } } });
  });
  await page.route('**/api/speech/transcribe', async route => {
    stats.transcripts++;
    await route.fulfill({ status: 503, json: { error: { userMessage: 'Silence must not be transcribed.' } } });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /给面包打(?:个)?电话/ })).not.toHaveAttribute('aria-disabled', 'true');
  return stats;
}

test('a tap connects to the actual local welcome audio without a synthesis round trip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const stats = await setup(page);
  await page.evaluate(() => { (window as any).__openingTap = performance.now(); });
  await page.getByRole('button', { name: /给面包打(?:个)?电话/ }).click();
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'speaking');
  await expect(page.locator('.cstage')).toHaveAttribute('data-pose', 'lifted');
  await expect.poll(() => page.locator('.cstage .rp-hs-r').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).b)).toBeGreaterThan(0.9);
  // During a desktop-to-portrait resize, the stage width transition must fit its new container.
  await page.setViewportSize({ width: 390, height: 844 });
  const fit = await page.locator('.callroom__main').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.client);
  const timing = await page.evaluate(() => {
    const start = (window as any).__openingStarts[0];
    return { clickToActualAudioMs: start.at - (window as any).__openingTap, audioDurationSeconds: start.duration };
  });
  expect(timing.audioDurationSeconds).toBeGreaterThan(2);
  expect(timing.audioDurationSeconds).toBeLessThan(4);
  expect(timing.clickToActualAudioMs).toBeLessThan(5000);
  await expect(page.locator('.callroom')).toContainText(CALL_GREETING.text);
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'listening');
  expect(stats).toEqual({ syntheses: 0, transcripts: 0 });
  await page.getByRole('button', { name: '挂断', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__openingTracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__openingContexts.every((c: AudioContext) => c.state === 'closed'))).toBe(true);
  mkdirSync('output/playwright', { recursive: true });
  writeFileSync('output/playwright/living-greeting-browser.json', JSON.stringify({ ...timing, ...stats, conditions: 'Chromium, silent virtual microphone, real local MiniMax recording, mocked capability availability. Not physical-device or cloud-response latency.' }, null, 2));
});

test('hangup during dialling releases late microphone permission without playing the opening', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const gate = new Promise<void>(resolve => { (window as any).__allowOpeningMic = resolve; });
    navigator.mediaDevices.getUserMedia = async constraints => {
      await gate; const stream = await original(constraints);
      (window as any).__openingMicResolved = true;
      return stream;
    };
  });
  const stats = await setup(page);
  await page.getByRole('button', { name: /给面包打(?:个)?电话/ }).click();
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'connecting');
  await expect(page.locator('.cstage')).toHaveAttribute('data-pose', 'dialing');
  // The angle is animated on the parent and inherited by the wheel and hole walls.
  // Observe the rendered rotation, independently of which element owns the animation.
  const wheel = page.locator('.cstage .rp-wheel');
  const firstRotation = await wheel.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).b);
  await expect.poll(() => wheel.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).b)).not.toBe(firstRotation);
  await page.getByRole('button', { name: '挂断', exact: true }).click();
  await page.evaluate(() => (window as any).__allowOpeningMic());
  await expect(page.locator('.callroom')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !!(window as any).__openingMicResolved)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__openingTracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__openingContexts.every((c: AudioContext) => c.state === 'closed'))).toBe(true);
  expect(await page.evaluate(() => (window as any).__openingStarts.length)).toBe(0);
  expect(stats).toEqual({ syntheses: 0, transcripts: 0 });
});

test('the entry greeting, phone and title stay separate across widths and patting preserves a typed draft', async ({ page }) => {
  await setup(page);
  for (const width of [320, 375, 390, 778, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    const greeting = await page.locator('.hello-bubble').boundingBox();
    const phone = await page.locator('.phone-door__phone').boundingBox();
    expect(greeting!.y + greeting!.height).toBeLessThanOrEqual(phone!.y);
    if (width <= 900) {
      const plate = await page.locator('.phone-door__text').boundingBox();
      const title = await page.locator('.entry__title').boundingBox();
      expect(plate!.y + plate!.height).toBeLessThanOrEqual(title!.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const input = page.getByRole('textbox', { name: '想写的时候，写在这儿', exact: true });
  await input.fill('今天有一点累。');
  await page.getByRole('button', { name: '摸摸面包', exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('今天有一点累。');
  await expect(page.locator('.entry__scene .plush')).toHaveAttribute('data-poke', /smile|wiggle/);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page.locator('.entry__scene .p-breathe').evaluate(el => {
    const css = getComputedStyle(el);
    return { duration: parseFloat(css.animationDuration), iterations: css.animationIterationCount };
  });
  expect(motion.duration).toBeLessThan(0.001);
  expect(motion.iterations).toBe('1');
});
