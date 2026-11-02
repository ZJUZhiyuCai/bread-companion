// Playwright CLI run-code. Synthetic silent microphone only; cloud speech endpoints are blocked.
async (page) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, options) {
      return getContext.call(this, kind, kind === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const stream = context.createMediaStreamDestination().stream;
      for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => {stop(); void context.close();}; }
      return stream;
    };
  });
  await page.route('**/api/capabilities', async route => {
    const response = await route.fetch(); const caps = await response.json();
    caps.asr.available = caps.tts.available = caps.agent.configured = true;
    caps.tts.greeting = '/companion/hello-warm-bestie.mp3?v=1';
    await route.fulfill({ json: caps });
  });
  await page.route('**/api/speech/**', route => route.fulfill({status:503,json:{error:{userMessage:'Asset capture: cloud audio disabled.'}}}));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:1440,height:1200});
  await page.goto('http://127.0.0.1:3210/');
  await page.getByRole('button',{name:'给面包打个电话',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.phone-door__btn')?.getAttribute('aria-disabled')!=='true');
  await page.getByRole('button',{name:'给面包打个电话',exact:true}).click();
  await page.locator('.callroom[data-phase="listening"]').waitFor({timeout:15000});
  await page.locator('.cstage .phone3d[data-state="ready"] canvas').waitFor({state:'visible',timeout:15000});
  await page.addStyleTag({content:'.cstage{width:1000px!important;height:820px!important;max-width:none!important;min-width:1000px!important;}'});
  await page.waitForTimeout(800);
  for (const pose of ['lifted','rest']) {
    if(pose==='rest') {
      await page.getByRole('button',{name:'挂断',exact:true}).click();
      await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Poster fixture','NotAllowedError');};});
      await page.getByRole('button',{name:'给面包打个电话',exact:true}).click();
      await page.locator('.callroom[data-phase="error"]').waitFor();
      await page.locator('.cstage .phone3d[data-state="ready"] canvas').waitFor({timeout:15000});
      await page.waitForTimeout(700);
    }
    const pending = page.waitForEvent('download');
    await page.locator('.cstage .phone3d canvas').evaluate((canvas, pose) => {
      const a=document.createElement('a');a.download='bread-phone-call-'+pose+'.png';a.href=canvas.toDataURL('image/png');a.click();
    },pose);
    await (await pending).saveAs('output/playwright/bread-phone-call-'+pose+'.png');
  }
  await page.getByRole('button',{name:'挂断',exact:true}).click();
  return {source:'Current production PhoneEngine/CALL_PHONE; actual transparent buffers',physicalMic:false,cloudCalls:false,poses:['lifted','rest']};
}
