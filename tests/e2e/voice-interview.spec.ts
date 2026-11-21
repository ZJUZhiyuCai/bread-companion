import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { CALL_GREETING } from '../../domain/call-greeting';
import type { Capabilities, TurnRequest } from '../../domain/types';
import { encodeWav } from '../../services/media-controller';

const ENTRY_INTERVIEW = '准备下一场，来一段模拟面试';
const START_INTERVIEW = '开始语音模拟面试';
const REJECTION = '这次前端面试被拒了，我有点难受。';
const ANSWER = '我用埋点对照了上线前后的首屏耗时，确认缓存改动起了作用。';
const FIRST_QUESTION = '选一个你实际参与过的项目，说说你负责了哪一部分？';
const FRONTEND_QUESTION = '讲一次你处理过的页面性能问题，你是从哪里开始定位的？';
const FOLLOW_UP = '你用什么指标判定这个做法有效，判定阈值是怎么选的？';
const DEBRIEF = '这场模拟的小复盘';

type TestWindow = typeof window & {
  __micAttempts: number;
  __callTracks: MediaStreamTrack[];
  __speakIntoCall: () => void;
};

test.use({ viewport: { width: 1440, height: 900 } });

// Use a short segment of the voice fixture and let the real AudioWorklet/VAD end each turn.
// Send speech after the UI is ready so the test does not depend on a fixed capture offset.
const input = readFileSync(new URL('../fixtures/voice-input.wav', import.meta.url));
const pcm = new DataView(input.buffer, input.byteOffset + 44, input.byteLength - 44);
const sampleRate = 16000;
const speech = Float32Array.from({ length: sampleRate * 0.7 }, (_, i) => pcm.getInt16(i * 2, true) / 32768 * 0.2);
const speechWav = Buffer.from(encodeWav(speech)).toString('base64');
const replyWav = Buffer.from(encodeWav(Float32Array.from({ length: sampleRate }, (_, i) =>
  0.06 * Math.sin(2 * Math.PI * 213 * i / sampleRate),
)));

async function setup(page: Page, { transcripts = [], voice = true }: { transcripts?: string[]; voice?: boolean } = {}) {
  const stats = { turns: [] as TurnRequest[], synthesized: [] as string[], uploads: 0 };
  await page.addInitScript((wav) => {
    const w = window as TestWindow;
    w.__micAttempts = 0;
    w.__callTracks = [];
    const NativeAudioContext = window.AudioContext;
    let captureContext: AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        captureContext = this;
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      w.__micAttempts += 1;
      const context = captureContext;
      const destination = context.createMediaStreamDestination();
      const clip = await context.decodeAudioData(Uint8Array.from(atob(wav), (ch) => ch.charCodeAt(0)).buffer);
      w.__callTracks.push(...destination.stream.getAudioTracks());
      w.__speakIntoCall = () => {
        const source = context.createBufferSource();
        source.buffer = clip;
        source.connect(destination);
        source.onended = () => source.disconnect();
        source.start(context.currentTime + 0.02);
      };
      return destination.stream;
    };
  }, speechWav);

  await page.route('**/api/capabilities', async (route) => {
    const response = await route.fetch();
    const caps: Capabilities = await response.json();
    caps.agent.configured = true;
    caps.asr = { ...caps.asr, available: voice, opusUpload: false, callPipeline: false };
    caps.tts = { ...caps.tts, available: voice, greeting: undefined, turnStream: false, sentenceStream: false };
    await route.fulfill({ json: caps });
  });
  await page.route('**/api/agent/turn', async (route) => {
    stats.turns.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.route('**/api/speech/transcribe', async (route) => {
    const request = route.request();
    const upload = new Request(request.url(), {
      method: 'POST',
      headers: { 'Content-Type': request.headers()['content-type'] },
      body: new Uint8Array(request.postDataBuffer()!),
    });
    const form = await upload.formData();
    const file = form.get('file') as File;
    const view = new DataView(await file.arrayBuffer());
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.byteLength).toBeGreaterThan(44);
    const text = transcripts[stats.uploads++] ?? '';
    await route.fulfill({ json: { requestId: form.get('requestId'), text, confirmed: false } });
  });
  await page.route('**/api/speech/synthesize', async (route) => {
    stats.synthesized.push(route.request().postDataJSON().text);
    await route.fulfill({ body: replyWav, contentType: 'audio/wav' });
  });
  return stats;
}

async function dial(page: Page) {
  await page.goto('/');
  const phone = page.getByRole('button', { name: /给面包打个电话/ });
  await expect(phone).toBeEnabled();
  await phone.click();
  await expect(page.locator('.callroom')).toHaveAttribute('data-phase', 'listening');
}

const speak = (page: Page) => page.evaluate(() => (window as TestWindow).__speakIntoCall());
const microphone = (page: Page) => page.evaluate(() => {
  const { __micAttempts, __callTracks } = window as TestWindow;
  return { attempts: __micAttempts, tracks: __callTracks.map(({ id, readyState }) => ({ id, readyState })) };
});

async function liveMic(page: Page) {
  const mic = await microphone(page);
  expect(mic.attempts).toBe(1);
  expect(mic.tracks).toEqual([expect.objectContaining({ readyState: 'live' })]);
  return mic;
}

test('a recovery call becomes a voice interview and saves a debrief grounded in the spoken answer', async ({ page }) => {
  const stats = await setup(page, { transcripts: [REJECTION, ANSWER] });
  await dial(page);
  const room = page.locator('.callroom');
  const panel = room.locator('.call-interview');
  const mic = await liveMic(page);

  await speak(page);
  await expect(room.getByRole('log')).toContainText('收到了不想看到的结果');
  await expect(room).toHaveAttribute('data-phase', 'listening');
  expect(stats.turns[0]).toMatchObject({ mode: 'listen', channel: 'call', userMessage: REJECTION });

  await room.getByRole('button', { name: START_INTERVIEW, exact: true }).click();
  await expect(room.locator('.callroom__mode-pill')).toHaveText('模拟面试 · 第 1/4 轮');
  await expect(panel.getByText(FRONTEND_QUESTION, { exact: true })).toBeVisible();
  await expect(panel.getByText('定位方法', { exact: true })).toBeVisible();
  await expect(panel.getByText('验证效果', { exact: true })).toBeVisible();
  await expect(room).toHaveAttribute('data-phase', 'listening');
  expect(await microphone(page)).toEqual(mic);

  const gentle = panel.getByRole('button', { name: '温和陪练', exact: true });
  const realistic = panel.getByRole('button', { name: '真实深挖', exact: true });
  await expect(gentle).toHaveAttribute('aria-pressed', 'true');
  await realistic.click();
  await expect(realistic).toHaveAttribute('aria-pressed', 'true');
  await expect(room).toHaveAttribute('data-phase', 'listening');
  expect(await microphone(page)).toEqual(mic);

  await speak(page);
  await expect(room.locator('.callroom__mode-pill')).toHaveText('模拟面试 · 第 2/4 轮', { timeout: 10000 });
  await expect(panel.getByText(FOLLOW_UP, { exact: true })).toBeVisible();
  expect(stats.turns.find((turn) => turn.userMessage === ANSWER)).toMatchObject({
    mode: 'interview', channel: 'call', context: { interview: { round: 1, style: 'realistic' } },
  });
  await panel.getByText('最近的答题记录', { exact: true }).click();
  await expect(panel.getByText('回答提到了埋点。', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: '收尾复盘', exact: true }).click();
  await expect(room.locator('.callroom__mode-pill')).toHaveText('模拟复盘');
  await expect(panel.getByRole('heading', { name: DEBRIEF, exact: true })).toBeVisible();
  await expect(panel.locator('.call-interview__card')).toContainText(ANSWER);
  await expect(realistic).toBeDisabled();
  expect(await microphone(page)).toEqual(mic);

  await panel.getByRole('button', { name: '查看并保存复盘卡', exact: true }).click();
  await expect(room).toHaveCount(0);
  await expect.poll(() => microphone(page)).toEqual({ attempts: 1, tracks: mic.tracks.map((track) => ({ ...track, readyState: 'ended' })) });
  const tray = page.getByRole('complementary', { name: '今晚的卡片与材料' });
  await expect(tray.getByRole('heading', { name: '卡片', exact: true })).toBeFocused();
  await expect(tray.getByRole('heading', { name: DEBRIEF, exact: true })).toBeVisible();
  await tray.getByRole('button', { name: '留下这张…', exact: true }).click();
  const save = page.getByRole('dialog');
  await save.getByText('连同它引用的 1 段原话', { exact: true }).click();
  await expect(save.getByText(ANSWER, { exact: true })).toBeVisible();
  await save.getByRole('button', { name: '就留下这些', exact: true }).click();
  await expect(save.getByRole('heading', { name: '留好了', exact: true })).toBeVisible();
});

test('the entry opens directly to a spoken interview question and exits to listening on the same call', async ({ page }) => {
  const stats = await setup(page);
  await page.goto('/');
  const entry = page.getByRole('button', { name: ENTRY_INTERVIEW, exact: true });
  await expect(entry).toHaveAccessibleDescription('通电话多轮追问，温和陪练或真实深挖，练完一起复盘');
  await entry.click();

  const room = page.locator('.callroom');
  await expect(page.locator('.session')).toHaveAttribute('data-mode', 'interview');
  await expect(room).toHaveAttribute('data-phase', 'speaking');
  await expect(room.locator('.callroom__mode-pill')).toHaveText('模拟面试 · 第 1/4 轮');
  await expect(room.locator('.cap--bread')).toContainText(FIRST_QUESTION);
  expect(stats.synthesized).toEqual([`我们先从你熟悉的经历开始。${FIRST_QUESTION}`]);
  await expect(room.getByRole('log')).not.toContainText(CALL_GREETING.text);
  const mic = await liveMic(page);

  await room.getByRole('button', { name: '回到聊聊', exact: true }).click();
  await expect(page.locator('.session')).toHaveAttribute('data-mode', 'listen');
  await expect(room).toHaveAttribute('data-phase', 'listening');
  await expect(room.locator('.call-interview')).toHaveCount(0);
  await expect(room.getByRole('button', { name: START_INTERVIEW, exact: true })).toBeVisible();
  expect(await microphone(page)).toEqual(mic);
});

async function auditPhone(page: Page, slot: string) {
  const [status, content, controls] = await Promise.all(
    ['.callroom__status', slot, '.callroom__controls'].map((selector) => page.locator(selector).boundingBox()),
  );
  expect(status!.y + status!.height).toBeLessThanOrEqual(content!.y);
  expect(content!.y + content!.height).toBeLessThanOrEqual(controls!.y);
  for (const label of ['静音', '说完了', '挂断']) {
    const key = page.getByRole('button', { name: label, exact: true });
    await expect(key).toBeInViewport({ ratio: 1 });
    const box = (await key.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(700);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(slot).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
}

test('the 320×700 reduced-motion captions and question card keep the call keys reachable in both themes', async ({ page }) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  await dial(page);
  const room = page.locator('.callroom');
  await room.getByRole('button', { name: START_INTERVIEW, exact: true }).click();
  await expect(room.locator('.cap--bread')).toContainText(FIRST_QUESTION);
  await expect(room).toHaveAttribute('data-phase', 'listening');
  await expect(room.locator('.callroom__hint')).toContainText('说完了');

  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    await expect(room.locator('.callroom__question-hint')).toContainText(FIRST_QUESTION);
    await auditPhone(page, '.callroom__captions');

    const toggle = room.getByRole('button', { name: '面试题卡', exact: true });
    await toggle.press('Enter');
    await expect(room.getByRole('button', { name: '回到字幕', exact: true })).toBeFocused();
    await expect(room.getByRole('button', { name: '回到字幕', exact: true })).toHaveAttribute('aria-expanded', 'true');
    const panel = room.locator('.call-interview--compact');
    await expect(panel.getByText(FIRST_QUESTION, { exact: true })).toBeVisible();
    await expect(panel).toHaveCSS('overflow-y', 'auto');
    await auditPhone(page, '.call-interview--compact');

    await room.getByRole('button', { name: '回到字幕', exact: true }).click();
    await expect(room.locator('.callroom__captions')).toBeVisible();
  }
});

test('the entry falls back to a complete text interview when voice is unavailable', async ({ page }) => {
  const stats = await setup(page, { voice: false });
  await page.goto('/');
  const entry = page.getByRole('button', { name: ENTRY_INTERVIEW, exact: true });
  await expect(entry).toHaveAccessibleDescription('文字多轮追问模拟，练完一起复盘');
  await entry.click();

  const ticket = page.locator('.ticket--interview');
  await expect(ticket).toContainText(FIRST_QUESTION);
  await expect(ticket).toContainText('你的负责范围');
  await expect(ticket.getByRole('button', { name: '改用电话练', exact: true })).toHaveCount(0);
  expect(await microphone(page)).toEqual({ attempts: 0, tracks: [] });
  expect(stats.turns[0]).toMatchObject({ mode: 'interview', channel: 'text' });
  const realistic = ticket.getByRole('button', { name: '真实深挖', exact: true });
  await realistic.click();
  await expect(realistic).toHaveAttribute('aria-pressed', 'true');
  await ticket.getByRole('button', { name: '收尾复盘', exact: true }).click();
  await expect(ticket).toContainText('赛后复盘');
  await expect(realistic).toBeDisabled();
  await ticket.getByRole('button', { name: '再练一场', exact: true }).click();
  await expect(ticket).toContainText(FIRST_QUESTION);
  await ticket.getByRole('button', { name: '回到只是聊聊', exact: true }).click();
  await expect(page.locator('.session')).toHaveAttribute('data-mode', 'listen');
  await expect(page.getByRole('heading', { name: '和面包说说话', exact: true })).toBeFocused();
});

test('the text interview offer can move an existing question into a call', async ({ page }) => {
  const stats = await setup(page);
  await page.goto('/');
  await page.getByRole('button', { name: '进去慢慢写', exact: true }).click();
  await page.getByRole('textbox', { name: '写给面包', exact: true }).fill(REJECTION);
  await page.getByRole('button', { name: '发出', exact: true }).click();
  await page.getByRole('button', { name: '模拟面试', exact: true }).click();
  const ticket = page.locator('.ticket--interview');
  await expect(ticket).toContainText(FRONTEND_QUESTION);
  await ticket.getByRole('button', { name: '改用电话练', exact: true }).click();

  const room = page.locator('.callroom');
  await expect(room).toHaveAttribute('data-phase', 'listening');
  await expect(room.locator('.call-interview__question')).toHaveText(FRONTEND_QUESTION);
  await expect(room.locator('.callroom__mode-pill')).toHaveText('模拟面试 · 第 1/4 轮');
  await liveMic(page);
  expect(stats.synthesized).toEqual([]);
});
