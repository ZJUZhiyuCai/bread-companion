import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('a late companion photo arrives whole, without loose facial features', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  await page.route('**/companion/bread-plush.webp', async route => {
    await gate; await route.fulfill({ body: readFileSync('public/companion/bread-plush.webp'), contentType: 'image/webp' });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-plush', 'wait');
  const face = page.locator('.entry__scene .p-face');
  expect(await face.evaluate(el => getComputedStyle(el).maskImage)).toContain('url(');
  await page.getByRole('textbox', { name: '想写的时候，写在这儿', exact: true }).fill('我在这里。');
  release(); await expect(page.locator('html')).toHaveAttribute('data-plush', 'ready');
  await expect(page.getByRole('textbox', { name: '想写的时候，写在这儿', exact: true })).toHaveValue('我在这里。');
});

test('a failed photo never removes the face mask; reduced motion keeps the writing flow immediate', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/companion/bread-plush.webp', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/'); await expect(page.locator('html')).toHaveAttribute('data-plush', 'late');
  expect(await page.locator('.entry__scene .p-face').evaluate(el => getComputedStyle(el).maskImage)).toContain('url(');
  await page.getByRole('button', { name: /进去慢慢写/ }).click();
  const text = page.getByRole('textbox', { name: '写给面包', exact: true });
  await expect(text).toBeFocused(); await text.fill('我今天不想复盘。');
  expect(await page.evaluate(() => document.getAnimations().some(a => a.constructor.name === 'ViewTransition'))).toBe(false);
  expect(errors).toEqual([]);
});
