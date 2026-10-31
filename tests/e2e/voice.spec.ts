import { test, expect } from '@playwright/test';
import { encodeWav } from '../../services/media-controller';

test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });

test('browser recording converts to WAV, requires transcript confirmation, and cancel never uploads',async({page})=>{
  let uploads=0; let wavBytes=0; let tts=0;
  await page.route('**/api/capabilities',async route=>{
    const response=await route.fetch(); const caps=await response.json();
    caps.asr.available=true; caps.tts.available=true;
    await route.fulfill({json:caps});
  });
  await page.route('**/api/speech/transcribe',async route=>{
    uploads++;
    const req=new Request('http://localhost/transcribe',{method:'POST',headers:{'Content-Type':route.request().headers()['content-type']},body:new Uint8Array(route.request().postDataBuffer()!)});
    const form=await req.formData();const file=form.get('file') as File;
    const bytes=await file.arrayBuffer(); const view=new DataView(bytes);
    expect(new TextDecoder().decode(bytes.slice(0,4))).toBe('RIFF');
    expect(view.getUint32(24,true)).toBe(16000);expect(view.getUint16(22,true)).toBe(1);
    wavBytes=bytes.byteLength;
    await route.fulfill({json:{requestId:form.get('requestId'),text:'我准备了三天。',confirmed:false}});
  });
  await page.route('**/api/speech/synthesize',async route=>{
    tts++;await route.fulfill({body:Buffer.from(encodeWav(new Float32Array(16000*4))),contentType:'audio/wav'});
  });
  await page.goto('/');await page.getByRole('button',{name:/进去慢慢写/}).click();
  await page.getByRole('button',{name:'录一段话：转成字后先给你改，再决定发不发',exact:true}).click();
  await expect(page.locator('time')).toHaveText('0:01',{timeout:7000});
  await page.getByRole('button',{name:'说完了',exact:true}).click();
  const draft=page.getByRole('textbox',{name:/转好的文字/});
  await expect(draft).toHaveValue('我准备了三天。');
  expect(uploads).toBe(1);expect(wavBytes).toBeGreaterThan(16000);
  await expect(page.getByRole('log')).not.toContainText('我准备了三天。');
  await draft.fill('其实我准备了一天。');await page.getByRole('button',{name:'发出去',exact:true}).click();
  await expect(page.getByRole('log')).toContainText('其实我准备了一天。');
  await expect(page.getByRole('button',{name:'录一段话：转成字后先给你改，再决定发不发',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'录一段话：转成字后先给你改，再决定发不发',exact:true}).click();
  await expect(page.getByText('在录这一段',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'不要这段',exact:true}).click();
  expect(uploads).toBe(1);await expect(page.getByRole('textbox',{name:'写给面包',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'念给我听',exact:true}).first().click();
  await expect(page.getByRole('button',{name:'停止播放',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'停止播放',exact:true}).click();
  await expect(page.getByRole('button',{name:'停止播放',exact:true})).toHaveCount(0);
  expect(tts).toBe(1);await page.getByRole('button',{name:'结束',exact:true}).click();
  await expect(page.getByText('今晚先停在这里。',{exact:true})).toBeVisible();
  expect(uploads).toBe(1);
});
