import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { mockCandidate } from '../../server/providers/mock-agent';

const opening='刚收到拒信。我准备了三天，最后只收到一句不合适。';
const reply='准备了三天，最后却只得到很简短的回复。你现在最想说的是这个结果，还是面试里某个一直放不下的片段？';
async function enter(page:Page) { await page.goto('/');await page.getByRole('button',{name:/进去慢慢写/}).click(); }
async function send(page:Page,text:string) { await page.getByRole('textbox',{name:'写给面包',exact:true}).fill(text);await page.getByRole('button',{name:'发出',exact:true}).click(); }
async function note(page:Page) {
  await enter(page);await send(page,opening);await expect(page.getByText(reply,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'留个记号',exact:true}).click();await expect(page.getByRole('button',{name:'留下这张…',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/确认这一版/})).toHaveCount(0);
}
async function keep(page:Page) {
  await page.getByRole('button',{name:'留下这张…',exact:true}).first().click();
  await page.getByRole('button',{name:'就留下这些',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('留好了');
  await page.getByRole('button',{name:'好',exact:true}).click();
}
async function audit(page:Page) {const a=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(a.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);}

test('the quiet entry needs explicit intent: empty Enter stays, composition stays, limits hold, and an empty click opens chat',async({page})=>{
  let turns=0;
  page.on('request',request=>{if(request.url().endsWith('/api/agent/turn'))turns++;});
  await page.route('**/api/capabilities',async route=>{
    const response=await route.fetch();const caps=await response.json();caps.limits.maxInputChars=12;
    await route.fulfill({json:caps});
  });
  await page.goto('/');
  const title=page.getByRole('heading',{name:'先在这儿待一会儿。',exact:true});
  const input=page.getByRole('textbox',{name:'想写的时候，写在这儿',exact:true});
  await expect(page.getByRole('button',{name:/关于面包：一个 AI，现在是规则演示/})).toBeVisible();
  await input.press('Enter');await expect(title).toBeVisible();
  await input.fill('先');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true});await expect(title).toBeVisible();
  await input.press('Shift+Enter');await expect(input).toHaveValue('先\n');
  await input.fill('这是一句超过十二个字的输入内容。');
  await expect(page.getByRole('button',{name:'说给面包',exact:true})).toBeDisabled();
  await input.press('Enter');await expect(title).toBeVisible();
  await expect(page.getByText('超过 12 字了，可以先说一部分',{exact:true})).toBeVisible();
  await input.fill('   ');await page.getByRole('button',{name:'进去慢慢写',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'写给面包',exact:true})).toBeFocused();
  expect(turns).toBe(0);
});

test('listening first never asks for microphone access and has an honest text fallback',async({page})=>{
  await page.addInitScript(()=>{
    (window as any).__entryMicCalls=0;
    navigator.mediaDevices.getUserMedia=async()=>{(window as any).__entryMicCalls++;throw new Error('No microphone in listen-first mode');};
  });
  await page.goto('/');
  const listen=page.getByRole('button',{name:/先听面包说一小段/});
  await expect(listen).toContainText('现在只有文字');
  expect(await page.evaluate(()=>(window as any).__entryMicCalls)).toBe(0);
  await listen.click();
  await expect(page.getByText('给你的一小段话',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'播放这段话',exact:true})).toHaveCount(0);
  await expect(page.getByRole('textbox',{name:'写给面包',exact:true})).not.toBeFocused();
  expect(await page.evaluate(()=>(window as any).__entryMicCalls)).toBe(0);
});

test('light and dark entry keep the telephone reachable with standard and extra-large text across widths',async({page})=>{
  await page.route('**/api/capabilities',async route=>{
    const response=await route.fetch();const caps=await response.json();
    caps.asr.available=caps.tts.available=caps.agent.configured=true;
    await route.fulfill({json:caps});
  });
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/');
  for(const size of ['标准','特大']) {
    await page.getByRole('button',{name:/关于面包：一个 AI/}).click();
    await page.getByRole('radio',{name:size,exact:true}).check();
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    for(const colorScheme of ['light','dark'] as const) {
      await page.emulateMedia({colorScheme});
      for(const width of [320,390,778,1440]) {
        await page.setViewportSize({width,height:1000});
        await page.getByRole('button',{name:/给面包打个电话/}).scrollIntoViewIfNeeded();
        const title=await page.locator('.entry__title').boundingBox();
        const plate=await page.locator('.phone-door__text').boundingBox();
        if(width<=900)expect(plate!.y+plate!.height).toBeLessThanOrEqual(title!.y);
        if(width<=360 || (size==='特大' && width<=420)) {
          const bubble=await page.locator('.hello-bubble').boundingBox();
          const eye=await page.locator('.entry__scene .p-ball').last().boundingBox();
          expect(bubble!.y+bubble!.height).toBeLessThanOrEqual(eye!.y);
        }
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        const fit=await page.locator('.phone-door__text').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));
        expect(fit.scroll).toBeLessThanOrEqual(fit.client);
        await page.screenshot({path:`output/playwright/calm-${colorScheme}-${width}-${size}.png`,fullPage:true});
      }
      await audit(page);
    }
  }
});

test('first sentence starts a conversation directly; refusal and ending never force review',async({page})=>{
  await page.goto('/');await page.getByRole('textbox',{name:'想写的时候，写在这儿'}).fill(opening);await page.getByRole('button',{name:'说给面包',exact:true}).click();
  await expect(page.getByText(reply,{exact:true})).toBeVisible();await send(page,'今晚不想复盘');
  await expect(page.getByText('好，今晚不做分析。可以继续说，也可以停在这里。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'结束',exact:true}).click();await expect(page.getByText('今晚先停在这里。',{exact:true})).toBeVisible();
  await expect(page.getByText(opening,{exact:true})).toHaveCount(0);await page.reload();await expect(page.getByRole('button',{name:/进去慢慢写/})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});

test('late candidate is discarded after ending even if the network completes',async({page})=>{
  let release:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;});
  await page.route('**/api/agent/turn',async route=>{const input=route.request().postDataJSON();await gate;await route.fulfill({json:mockCandidate(input)}).catch(()=>{});});
  await enter(page);await send(page,'这句话不应该在结束后引出回复。');await page.getByRole('button',{name:'结束',exact:true}).click();release();
  await expect(page.getByText('今晚先停在这里。',{exact:true})).toBeVisible();await expect(page.getByRole('log')).toHaveCount(0);
});

test('an unsaved note survives ending and is only kept after the explicit preview action',async({page})=>{
  await note(page);await page.getByRole('button',{name:'结束',exact:true}).click();
  await expect(page.getByText('这张卡片还在桌上')).toBeVisible();
  await page.getByRole('button',{name:'留下这张…',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('连同它引用的');
  await page.getByRole('button',{name:'就留下这些',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('留好了');await page.getByRole('button',{name:'好',exact:true}).click();
  const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'JSON 备份',exact:true}).click();expect((await waiting).suggestedFilename()).toMatch(/\.json$/);
  await page.reload();await page.getByRole('button',{name:/以前留下的/}).click();
  await page.getByRole('dialog').getByRole('button',{name:/今晚，先留一个记号/}).click();
  await page.getByRole('button',{name:'从这台设备删除这一份'}).click();await page.getByRole('button',{name:'确定删除',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toContainText('今晚，先留一个记号');
});

test('source correction immediately invalidates an already saved card without another confirmation form',async({page})=>{
  await note(page);await keep(page);await page.getByRole('button',{name:'已放进材料 · 看看',exact:true}).first().click();
  await page.getByRole('button',{name:'改一改',exact:true}).first().click();await page.getByRole('textbox',{name:'改成你记得的样子'}).fill('其实我准备了一天。');await page.getByRole('button',{name:'就这样改',exact:true}).click();
  await expect(page.getByText(/这一版不再当作有效，也不能留下/)).toBeVisible();await expect(page.getByRole('button',{name:'留下这张…',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'对，是这样',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'让面包重新整理',exact:true}).first().click();await expect(page.getByRole('button',{name:'留下这张…',exact:true}).first()).toBeVisible();
});

test('provider failure retains text and leaves stop/end available',async({page})=>{
  await page.route('**/api/agent/turn',route=>route.fulfill({status:504,json:{error:{code:'TIMEOUT',userMessage:'这次处理超时了。',retryable:true}}}));
  await enter(page);await send(page,'这段失败后应该还在。');await expect(page.getByRole('alert').filter({hasText:'这次处理超时了。'})).toBeVisible();
  await expect(page.getByRole('log')).toContainText('这段失败后应该还在。');await expect(page.getByRole('button',{name:'结束',exact:true})).toBeEnabled();await expect(page.getByRole('textbox',{name:'写给面包'})).toBeEnabled();
});

test('mobile welcome and conversation have accessible semantics and keep controls in view',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});await page.goto('/');await audit(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:/进去慢慢写/}).click();await audit(page);
  for(const width of [320,390,768]) {await page.setViewportSize({width,height:844});await expect(page.getByRole('button',{name:/关于面包：一个 AI，现在是规则演示/})).toBeVisible();await expect(page.getByRole('button',{name:'停止',exact:true})).toBeInViewport();await expect(page.getByRole('button',{name:'结束',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
});

test('one-box material becomes a review, then the agent prepares a practice question without setup',async({page})=>{
  await enter(page);await page.getByRole('button',{name:'放一段材料',exact:true}).click();
  await page.getByRole('textbox',{name:'材料内容'}).fill('我应聘产品工程实习生。我回答收集二十个例子做科研绘图 Agent 测试，再人工检查图片，但当时没有说明通过标准。');
  await expect(page.getByRole('dialog').getByRole('combobox')).toHaveCount(0);await page.getByRole('button',{name:'放进来',exact:true}).click();
  await page.getByRole('button',{name:'看看那段回答',exact:true}).click();await expect(page.getByRole('button',{name:'留下这张…',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'练一题',exact:true}).click();await expect(page.getByText('在练这一题',{exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('checkbox')).toHaveCount(0);
  await send(page,'我会先检查坐标轴和图例是否正确，再由两位同学独立复核；尚未做过正式实验，不报告成功率。');
  await expect(page.getByRole('heading',{name:'这一题，慢慢来'})).toBeVisible();await page.getByRole('button',{name:'看看 / 改改',exact:true}).click();
  await expect(page.getByRole('complementary',{name:'今晚的卡片与材料'})).toContainText('第 2 版');await expect(page.getByRole('complementary',{name:'今晚的卡片与材料'})).toContainText('没有提供的数据先留空');
  await page.getByRole('button',{name:'不练了',exact:true}).click();await expect(page.getByText('在练这一题',{exact:true})).toHaveCount(0);
});

test('dark desktop card and save dialog retain contrast and accessible semantics',async({page})=>{
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await note(page);await audit(page);
  await page.getByRole('button',{name:'留下这张…',exact:true}).click();await audit(page);
});

test('repeated storage failure never claims success, permits retry without phantom version changes, and exports',async({page})=>{
  await note(page);await page.evaluate(()=>{IDBObjectStore.prototype.put=()=>{throw new DOMException('Quota fixture','QuotaExceededError');};});
  await page.getByRole('button',{name:'留下这张…',exact:true}).click();
  for(let n=0;n<2;n++) {await page.getByRole('button',{name:'就留下这些',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('这次没有留下来');await expect(page.getByRole('dialog')).not.toContainText('留好了');if(n===0){await page.getByRole('button',{name:'再试一次',exact:true}).click();await expect(page.getByRole('button',{name:'就留下这些',exact:true})).toBeEnabled();}}
  const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'先导出成文件',exact:true}).click();expect((await waiting).suggestedFilename()).toMatch(/\.json$/);
});

test('edit from preview removes unselected evidence; exported JSON imports and starts a new conversation',async({page})=>{
  await note(page);await page.getByRole('button',{name:'留下这张…',exact:true}).click();await page.getByRole('button',{name:'再改改',exact:true}).click();
  await page.getByRole('textbox',{name:'标题',exact:true}).fill('只留下未知，明天再看');await page.getByRole('button',{name:'删掉“我最在意的一件事”这一栏',exact:true}).click();await page.getByRole('button',{name:'改好了',exact:true}).click();
  await page.getByRole('button',{name:'结束',exact:true}).click();
  let waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Markdown',exact:true}).click();expect(await readFile((await (await waiting).path())!,'utf8')).toContain('规则演示（Mock）');
  waiting=page.waitForEvent('download');await page.getByRole('button',{name:'JSON 备份',exact:true}).click();const file=await waiting;const json=JSON.parse(await readFile((await file.path())!,'utf8'));
  expect(json.cards[0].revision).toBe(2);expect(json.selectedEvidence).toEqual([]);expect(json).not.toHaveProperty('messages');
  await page.reload();await page.getByRole('button',{name:/以前留下的/}).click();await expect(page.getByRole('dialog')).toContainText('抽屉是空的');
  await page.locator('input[type=file]').setInputFiles({name:'面包备份.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});
  await page.getByRole('dialog').getByRole('button',{name:/只留下未知，明天再看/}).click();await expect(page.getByRole('dialog')).toContainText('你改写的标题');await page.getByRole('button',{name:'继续看这道题',exact:true}).click();
  await expect(page.getByRole('log')).toContainText('之前留下的');await page.getByRole('button',{name:'结束',exact:true}).click();
  await page.getByRole('button',{name:'以前留下的',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:/只留下未知，明天再看/}).click();await page.getByRole('button',{name:'今天聊别的',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'写给面包',exact:true})).toBeVisible();await expect(page.getByRole('log')).not.toContainText(opening);
});


for (const recovery of ['button', 'online'] as const) test(`service discovery recovers via ${recovery} without reloading a draft or opening a mic`, async ({ page }) => {
  let checks = 0, turns = 0;
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => {
    (window as any).__readinessMic = 0;
    navigator.mediaDevices.getUserMedia = async () => { (window as any).__readinessMic++; throw new Error('Unexpected microphone'); };
  });
  page.on('request', r => { if (r.url().endsWith('/api/agent/turn')) turns++; });
  await page.route('**/api/capabilities', async route => {
    checks++;
    if (checks === 1) { await route.fulfill({ status: 503, body: 'Temporarily unavailable' }); return; }
    const response = await route.fetch(), caps = await response.json();
    caps.asr.available = caps.tts.available = caps.agent.configured = true;
    await route.fulfill({ json: caps });
  });
  await page.goto('/');
  const draft = page.getByRole('textbox', { name: '想写的时候，写在这儿', exact: true });
  await draft.fill('这句话还没想好怎么说。');
  const reconnect = page.getByRole('button', { name: '重新连接', exact: true });
  await expect(reconnect).toBeVisible();
  if (recovery === 'button') await reconnect.click();
  else await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(reconnect).toHaveCount(0);
  await expect(draft).toHaveValue('这句话还没想好怎么说。');
  await expect(page.getByRole('button', { name: /给面包打个电话/ })).not.toHaveAttribute('aria-disabled', 'true');
  expect(checks).toBe(2); expect(turns).toBe(0);
  expect(await page.evaluate(() => (window as any).__readinessMic)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
