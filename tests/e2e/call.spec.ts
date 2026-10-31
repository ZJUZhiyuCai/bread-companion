import { test, expect, type Page } from '@playwright/test';
import { encodeWav } from '../../services/media-controller';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';

const callInput = resolve('.local/test-call-input.wav');
test.use({launchOptions:{args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${callInput}`]}});
test.describe('continuous calls with a real browser audio graph',()=>{
  test.beforeAll(()=>{
    mkdirSync(resolve('.local'),{recursive:true});
    const input=readFileSync(resolve('tests/fixtures/voice-input.wav'));
    const wave=new Float32Array(16000*45);
    const samples=new DataView(input.buffer,input.byteOffset+44,input.byteLength-44);
    for(const offset of [3,17])for(let i=0;i<samples.byteLength/2;i++)wave[offset*16000+i]=samples.getInt16(i*2,true)/32768;
    writeFileSync(callInput,Buffer.from(encodeWav(wave)));
  });
  async function setup(page:Page, options:{holdASR?:boolean;failTTS?:boolean}={}){
    const stats={asr:0,tts:0,turns:[] as any[],bytes:0,release:()=>{}};
    let held:Promise<void>|undefined;if(options.holdASR)held=new Promise<void>(r=>{stats.release=r;});
    await page.addInitScript(()=>{
      (window as any).__callTracks=[];
      const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await original(constraints);(window as any).__callTracks.push(...stream.getTracks());return stream;};
    });
    await page.route('**/api/capabilities',async route=>{const r=await route.fetch();const c=await r.json();c.asr.available=true;c.tts.available=true;c.agent.configured=true;await route.fulfill({json:c});});
    await page.route('**/api/agent/turn',async route=>{stats.turns.push(route.request().postDataJSON());await route.continue();});
    await page.route('**/api/speech/transcribe',async route=>{
      stats.asr++;
      const request=new Request('http://localhost/transcribe',{method:'POST',headers:{'Content-Type':route.request().headers()['content-type']},body:new Uint8Array(route.request().postDataBuffer()!)});
      const form=await request.formData(),file=form.get('file') as File;
      const bytes=await file.arrayBuffer();const view=new DataView(bytes);stats.bytes=bytes.byteLength;
      expect(view.getUint32(24,true)).toBe(16000);expect(view.getUint16(22,true)).toBe(1);expect(bytes.byteLength).toBeGreaterThan(32000);
      if(held)await held;
      await route.fulfill({json:{requestId:form.get('requestId'),text:stats.asr===1?'我今天有点累，先不想复盘。':'我刚才给自己煮了一碗面。',confirmed:false}}).catch(()=>{});
    });
    await page.route('**/api/speech/synthesize',async route=>{
      stats.tts++;
      if(options.failTTS){await route.fulfill({status:503,json:{error:{userMessage:'声音暂时连接不上。'}}});return;}
      await route.fulfill({body:Buffer.from(encodeWav(new Float32Array(16000*(stats.tts===1?0.25:3)))),contentType:'audio/wav'});
    });
    return stats;
  }
  async function dial(page:Page){await page.goto('/');const button=page.getByRole('button',{name:/给面包打个电话/});await expect(button).not.toHaveAttribute('aria-disabled','true');await button.click();}
  async function tracksStopped(page:Page){await expect.poll(()=>page.evaluate(()=>(window as any).__callTracks.length>0&&(window as any).__callTracks.every((t:MediaStreamTrack)=>t.readyState==='ended'))).toBe(true);}
  test('automatically converses twice, supports mute/interruption, then keeps text after hangup',async({page})=>{
    test.setTimeout(55000);const stats=await setup(page);await dial(page);
    await expect(page.locator('.callroom')).toHaveAttribute('data-phase','listening');
    await expect.poll(()=>stats.asr,{timeout:15000}).toBe(1);
    await expect(page.getByRole('log')).toContainText('我今天有点累，先不想复盘。');
    await expect(page.locator('.callroom')).toHaveAttribute('data-phase','speaking');
    await page.getByRole('button',{name:'静音',exact:true}).click();await expect(page.getByRole('button',{name:'静音',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'插话',exact:true}).click();await expect(page.locator('.callroom')).toHaveAttribute('data-phase','listening');
    await page.getByRole('button',{name:'静音',exact:true}).click();await expect(page.locator('.callroom')).toHaveAttribute('data-phase','muted');
    expect(await page.evaluate(()=>(window as any).__callTracks.every((t:MediaStreamTrack)=>!t.enabled))).toBe(true);
    await page.getByRole('button',{name:'打开麦克风',exact:true}).click();
    await expect.poll(()=>stats.asr,{timeout:22000}).toBe(2);await expect(page.getByRole('log')).toContainText('我刚才给自己煮了一碗面。');
    await page.getByRole('button',{name:'挂断',exact:true}).click();await tracksStopped(page);
    await expect(page.getByRole('textbox',{name:'写给面包',exact:true})).toBeFocused();await expect(page.getByRole('log')).toContainText('我刚才给自己煮了一碗面。');
    expect(stats.turns).toHaveLength(2);expect(stats.turns.every(t=>t.channel==='call')).toBe(true);
    await page.getByRole('textbox',{name:'写给面包',exact:true}).fill('现在接着打字。');await page.getByRole('button',{name:'发出',exact:true}).click();await expect.poll(()=>stats.turns.length).toBe(3);expect(stats.turns[2].channel).toBe('text');
  });
  test('hanging up while ASR is pending discards the late transcript and never calls the agent',async({page})=>{
    const stats=await setup(page,{holdASR:true});await dial(page);await expect.poll(()=>stats.asr,{timeout:15000}).toBe(1);
    await page.getByRole('button',{name:'挂断',exact:true}).click();await tracksStopped(page);stats.release();
    await expect(page.getByRole('textbox',{name:'写给面包',exact:true})).toBeVisible();await expect(page.getByRole('log')).not.toContainText('我今天有点累');expect(stats.turns).toHaveLength(0);expect(stats.tts).toBe(1);
  });
  test('late microphone permission is released immediately after hangup',async({page})=>{
    const stats=await setup(page);
    await page.addInitScript(()=>{const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{await new Promise<void>(r=>{(window as any).__grantMic=r;});return original(c);};});
    await dial(page);await expect(page.locator('.callroom')).toHaveAttribute('data-phase','connecting');await page.getByRole('button',{name:'挂断',exact:true}).click();
    await page.evaluate(()=>(window as any).__grantMic());await tracksStopped(page);expect(stats.asr).toBe(0);expect(stats.tts).toBe(0);await expect(page.locator('.callroom')).toHaveCount(0);
  });
  test('denied permission gives a real retry and preserves a draft when returning to typing',async({page})=>{
    const stats=await setup(page);
    await page.addInitScript(()=>{(window as any).__micAttempts=0;navigator.mediaDevices.getUserMedia=async()=>{(window as any).__micAttempts++;throw new DOMException('denied','NotAllowedError');};});
    await page.goto('/');await page.getByRole('textbox',{name:'写下第一句，不用整理好',exact:true}).fill('这句还没写完。');await page.getByRole('button',{name:/给面包打个电话/}).click();
    await expect(page.locator('.callroom')).toHaveAttribute('data-phase','error');await expect(page.locator('.callroom').getByRole('alert')).toContainText('还没能打开麦克风');
    await page.getByRole('button',{name:'再试一次',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__micAttempts)).toBe(2);
    await page.getByRole('button',{name:'挂断',exact:true}).click();await expect(page.getByRole('textbox',{name:'写给面包',exact:true})).toHaveValue('这句还没写完。');expect(stats.asr).toBe(0);expect(stats.turns).toHaveLength(0);
  });
  test('backgrounding pauses and releases capture; keyboard resume and hangup remain available',async({page})=>{
    await setup(page);await dial(page);await expect(page.locator('.callroom')).toHaveAttribute('data-phase','listening');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    await expect(page.locator('.callroom')).toHaveAttribute('data-phase','paused');await tracksStopped(page);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'));});
    await page.getByRole('button',{name:'继续通话',exact:true}).click();await expect(page.locator('.callroom')).toHaveAttribute('data-phase','listening');await page.keyboard.press('Escape');await expect(page.locator('.callroom')).toHaveAttribute('data-phase','paused');
    await page.getByRole('button',{name:'挂断',exact:true}).click();await tracksStopped(page);
  });
  test('small screens keep call controls reachable, reduced motion and errors accessible',async({page})=>{
    await page.setViewportSize({width:320,height:700});await page.emulateMedia({reducedMotion:'reduce'});const stats=await setup(page,{failTTS:true});await dial(page);
    await expect(page.locator('.callroom')).toHaveAttribute('data-phase','error');
    for(const name of ['静音','再试一次','挂断']){const button=page.getByRole('button',{name,exact:true});await expect(button).toBeVisible();const box=await button.boundingBox();expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(700);}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(axe.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
    await page.getByRole('button',{name:'挂断',exact:true}).click();await tracksStopped(page);expect(stats.asr).toBe(0);
  });
  test('a paused small-screen call keeps long captions below status and above controls',async({page})=>{
    await page.setViewportSize({width:320,height:700});await page.emulateMedia({reducedMotion:'reduce'});const stats=await setup(page);await dial(page);
    await expect.poll(()=>stats.turns.length,{timeout:15000}).toBe(1);
    await expect(page.locator('.callroom')).toHaveAttribute('data-phase','speaking');await page.keyboard.press('Escape');
    await expect(page.locator('.callroom')).toHaveAttribute('data-phase','paused');await tracksStopped(page);
    const status=await page.locator('.callroom__status').boundingBox(),captions=await page.locator('.callroom__captions').boundingBox(),controls=await page.locator('.callroom__controls').boundingBox();
    expect(status!.y+status!.height).toBeLessThanOrEqual(captions!.y);expect(captions!.y+captions!.height).toBeLessThanOrEqual(controls!.y);
    const hangup=await page.getByRole('button',{name:'挂断',exact:true}).boundingBox();expect(hangup!.y+hangup!.height).toBeLessThanOrEqual(700);
    expect(await page.locator('.callroom__captions').evaluate(el=>getComputedStyle(el).overflowY)).toBe('auto');
    mkdirSync(resolve('output/playwright'),{recursive:true});await page.screenshot({path:'output/playwright/companion-call-paused-mobile.png'});
    await page.getByRole('button',{name:'挂断',exact:true}).click();
  });
});
