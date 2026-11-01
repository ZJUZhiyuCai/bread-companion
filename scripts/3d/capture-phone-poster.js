async (page) => {
  // Export the actual transparent render buffer, without page texture or CSS filters.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      return getContext.call(this, kind, kind === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
    };
  });
  await page.goto('http://127.0.0.1:3210/');
  await page.mouse.move(0, 0);
  await page.locator('.phone3d[data-state="ready"] canvas').waitFor({ state: 'visible', timeout: 15000 });
  await page.addStyleTag({ content: `
    html, body { background: transparent !important; }
    body * { visibility: hidden !important; background: none !important; box-shadow: none !important; filter: none !important; }
    .phone3d, .phone3d * { visibility: visible !important; }
    .phone-door--hero { width: 520px !important; top: 0 !important; right: 0 !important; }
  ` });
  await page.waitForTimeout(800);
  const pending = page.waitForEvent('download');
  await page.locator('.phone3d canvas').evaluate(canvas => {
    const a = document.createElement('a');
    a.download = 'bread-phone-rest.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  });
  await (await pending).saveAs('output/playwright/bread-phone-rest.png');
}
