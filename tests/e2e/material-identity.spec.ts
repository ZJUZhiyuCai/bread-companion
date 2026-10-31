import { test, expect, type Page } from '@playwright/test';

async function ready(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch();
    const caps = await response.json();
    caps.asr.available = caps.tts.available = caps.agent.configured = true;
    await route.fulfill({ json: caps });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /给面包打(?:个)?电话/ })).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('.entry__scene .plush')).not.toHaveAttribute('data-state', 'wave');
}

test('a stationary pointer at either telephone edge does not repeatedly enter and leave', async ({ page }) => {
  await ready(page);
  await page.mouse.move(1400, 950);
  const points = await page.locator('.phone-door__phone').evaluate(el => {
    const rect = el.getBoundingClientRect();
    for (const fraction of [0.35, 0.5, 0.65]) {
      const y = rect.y + rect.height * fraction;
      const hits: number[] = [];
      for (let x = Math.ceil(rect.x); x < rect.right; x++) {
        if (document.elementFromPoint(x, y)?.closest('.phone-door__btn')) hits.push(x);
      }
      if (hits.length > 4) return [{ x: hits[0] + 1, y }, { x: hits[hits.length - 1] - 1, y }];
    }
    return [];
  });
  expect(points).toHaveLength(2);
  await page.locator('.phone-door__btn').evaluate(el => {
    (window as any).__phoneHover = { enters: 0, leaves: 0 };
    el.addEventListener('pointerenter', () => { (window as any).__phoneHover.enters++; });
    el.addEventListener('pointerleave', () => { (window as any).__phoneHover.leaves++; });
  });
  for (const point of points) {
    await page.mouse.move(1400, 950);
    // Let the exit transition finish before probing the untransformed edge.
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => ({ ...(window as any).__phoneHover }));
    await page.mouse.move(point.x, point.y);
    // This observation window previously contained 24 enter/leave cycles.
    await page.waitForTimeout(1100);
    const after = await page.evaluate(() => ({ ...(window as any).__phoneHover }));
    expect(after.enters - before.enters).toBe(1);
    expect(after.leaves - before.leaves).toBe(0);
  }
});

test('eyes hold a settled gaze while the pointer rests on the telephone', async ({ page }) => {
  await ready(page);
  const phone = await page.locator('.phone-door__phone').boundingBox();
  await page.mouse.move(phone!.x + phone!.width * 0.5, phone!.y + phone!.height * 0.55);
  await page.waitForTimeout(1000);
  const samples: number[][] = [];
  for (let i = 0; i < 28; i++) {
    samples.push(await page.locator('.entry__scene .p-look').first().evaluate(el => {
      const matrix = new DOMMatrix(getComputedStyle(el).transform);
      return [matrix.e, matrix.f];
    }));
    await page.waitForTimeout(120);
  }
  // Measure local iris movement, excluding the body's independent slow breathing.
  for (const axis of [0, 1]) {
    const values = samples.map(sample => sample[axis]);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(0.5);
  }
});

test('the chat telephone keeps its bottom edge under a resting pointer', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: '我想说几句 进去慢慢打字', exact: true }).click();
  const phone = page.locator('.phone-door--panel .phone-door__btn');
  await expect(phone).toBeVisible();
  await page.mouse.move(1400, 950);
  await phone.evaluate(el => {
    (window as any).__panelHover = { enters: 0, leaves: 0 };
    el.addEventListener('pointerenter', () => { (window as any).__panelHover.enters++; });
    el.addEventListener('pointerleave', () => { (window as any).__panelHover.leaves++; });
  });
  const box = await phone.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height - 0.5);
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => (window as any).__panelHover)).toEqual({ enters: 1, leaves: 0 });
});
