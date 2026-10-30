import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { mockCandidate } from '../../server/providers/mock-agent';

async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /我想说几句/ }).click();
}
async function send(page: Page, text: string) {
  const composer=page.locator('textarea').first();
  await composer.fill(text); await page.getByRole('button',{name:'发送',exact:true}).click();
}
async function note(page: Page) {
  await enter(page); await send(page,'刚收到拒信。我准备了三天，最后只收到一句不合适。');
  await expect(page.getByText('准备了三天，最后却只得到很简短的回复。你现在最想说的是这个结果，还是面试里某个一直放不下的片段？',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/留个记号/}).click();
  await expect(page.getByRole('button',{name:'这样表述没问题，确认这一版'})).toBeVisible();
  await page.getByRole('button',{name:'这样表述没问题，确认这一版'}).click();
}

test('listen and end without forcing review; refresh loses temporary conversation',async({page})=>{
  await enter(page); await send(page,'刚收到拒信。我准备了三天，最后只收到一句不合适。');
  await expect(page.getByText('准备了三天，最后却只得到很简短的回复。你现在最想说的是这个结果，还是面试里某个一直放不下的片段？',{exact:true})).toBeVisible();
  await send(page,'今晚不想复盘');
  await expect(page.getByText('好，今晚不做分析。可以继续说，也可以停在这里。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'结束',exact:true}).click();
  await expect(page.getByText('今晚先停在这里。',{exact:true})).toBeVisible();
  await expect(page.getByText('刚收到拒信。我准备了三天，最后只收到一句不合适。',{exact:true})).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button',{name:/我想说几句/})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.length)).toBe(0);
});

test('late candidate is discarded after ending, even if the network completes',async({page})=>{
  let release:()=>void=()=>{};const gate=new Promise<void>(r=>{release=r;});
  await page.route('**/api/agent/turn',async route=>{const input=route.request().postDataJSON();await gate;await route.fulfill({json:mockCandidate(input)}).catch(()=>{});});
  await enter(page);await send(page,'这句话不应该在结束后引出回复。');
  await page.getByRole('button',{name:'结束',exact:true}).click();release();
  await expect(page.getByText('今晚先停在这里。',{exact:true})).toBeVisible();
  await expect(page.locator('[role="log"]')).toHaveCount(0);
});

test('confirmed note survives ending, explicit save preview, export and local deletion',async({page})=>{
  await note(page);
  await page.getByRole('button',{name:'结束',exact:true}).click();
  await page.getByRole('button',{name:'保存到本设备…',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('引用的摘录');
  await page.getByRole('button',{name:'保存第 1 版',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('已保存版本 1');
  await page.getByRole('button',{name:'好',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON 备份',exact:true}).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.reload();await page.getByRole('button',{name:/本设备档案/}).first().click();
  await expect(page.getByRole('dialog')).toContainText('今晚，先留一个记号');
  await page.getByRole('dialog').getByRole('button',{name:/记号卡 今晚，先留一个记号/}).click();
  const del=page.getByRole('dialog').getByRole('button',{name:/删除/}).first();await del.click();
  await page.getByRole('dialog').getByRole('button',{name:'确定删除',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toContainText('今晚，先留一个记号');
});

test('source correction invalidates a previously confirmed card',async({page})=>{
  await note(page);
  await page.getByRole('button',{name:'已放进材料，查看',exact:true}).first().click();
  await page.getByRole('button',{name:/修正/}).first().click();
  await page.getByRole('textbox',{name:/修正/}).fill('其实我准备了一天。');
  await page.getByRole('button',{name:'保存修正',exact:true}).click();
  await page.getByRole('tab',{name:/记号/}).click();
  await expect(page.getByText(/这一版不能确认，也不能保存/)).toBeVisible();
  await expect(page.getByRole('button',{name:'保存到本设备…',exact:true})).toHaveCount(0);
});

test('real model failure retains text input and ending controls',async({page})=>{
  await page.route('**/api/agent/turn',route=>route.fulfill({status:504,json:{error:{code:'TIMEOUT',userMessage:'这次处理超时了。',retryable:true}}}));
  await enter(page);await send(page,'这段失败后应该还在。');
  await expect(page.getByRole('alert').filter({hasText:'这次处理超时了。'})).toBeVisible();
  await expect(page.getByRole('button',{name:'结束',exact:true})).toBeEnabled();
  await expect(page.locator('textarea').first()).toBeEnabled();
});

test('welcome and active mobile view have no serious accessibility errors or horizontal overflow',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  let audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(audit.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:/我想说几句/}).click();
  audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(audit.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
  const stop=page.getByRole('button',{name:'停止',exact:true});await expect(stop).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  for (const width of [320,768]) {
    await page.setViewportSize({width,height:844});
    await expect(page.getByRole('button',{name:'规则演示',exact:true})).toBeVisible();
    await expect(stop).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
});

test('direct review confirms sources and practices one question in a new version',async({page})=>{
  await page.goto('/'); await page.getByRole('button',{name:/我想直接复盘/}).click();
  await page.getByRole('textbox',{name:'内容',exact:true}).fill('我应聘产品工程实习生。我回答收集二十个例子做科研绘图 Agent 测试，再人工检查图片，但当时没有说明通过标准。');
  await page.getByRole('button',{name:'放进材料',exact:true}).click();
  await page.getByRole('button',{name:'确认归属',exact:true}).click();
  await page.getByRole('button',{name:'开始复盘',exact:true}).click();
  await expect(page.getByRole('log')).toContainText('我把材料和未知分开放好了');
  await page.getByRole('tab',{name:/记号/}).click();
  await expect(page.getByRole('tabpanel')).toContainText('二十个例子');
  await page.getByRole('button',{name:'这样表述没问题，确认这一版'}).click();
  await page.getByRole('group',{name:'今晚想做什么'}).getByRole('button',{name:'练一题',exact:true}).click();
  await page.getByRole('textbox',{name:'题目',exact:true}).fill('如何为科研绘图 Agent 定义通过标准？');
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button',{name:'开始这道题',exact:true}).click();
  await page.getByRole('textbox',{name:'写给面包',exact:true}).fill('我会先检查坐标轴和图例是否正确，再由两位同学独立复核；尚未做过正式实验，不报告成功率。');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('log').getByText('我把材料和未知分开放好了。右侧是待核对的草稿；通用练习建议不代表招聘方的判断。',{exact:true})).toHaveCount(2);
  await page.getByRole('tab',{name:/记号/}).click();
  await expect(page.getByRole('tabpanel')).toContainText('这一题，慢慢来');
  await expect(page.getByRole('tabpanel')).toContainText('第 2 版');
  await expect(page.getByRole('tabpanel')).toContainText('没有提供的数据先留空');
});

test('dark desktop review and save dialog retain contrast and accessible semantics',async({page})=>{
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await note(page);
  let audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(audit.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
  await page.getByRole('button',{name:'保存到本设备…',exact:true}).click();
  audit=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  expect(audit.violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
});

test('storage failure does not claim success and still permits export',async({page})=>{
  await note(page);
  await page.evaluate(()=>{IDBObjectStore.prototype.put=()=>{throw new DOMException('Quota fixture','QuotaExceededError');};});
  await page.getByRole('button',{name:'保存到本设备…',exact:true}).click();
  await page.getByRole('button',{name:'保存第 1 版',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('没有保存成功');
  await expect(page.getByRole('dialog')).not.toContainText('已保存版本');
  await page.getByRole('button',{name:'好',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON 备份',exact:true}).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});

test('editing removes unselected evidence; JSON round-trip and starting a fresh talk work',async({page})=>{
  await note(page);
  await page.getByRole('button',{name:'再改改（会生成新版本）',exact:true}).click();
  await page.getByRole('textbox',{name:'标题',exact:true}).fill('只留下未知，明天再看');
  await page.getByRole('button',{name:'删掉“我最在意的一件事”这一条',exact:true}).click();
  await page.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByRole('button',{name:'这样表述没问题，确认这一版'}).click();
  let waiting=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Markdown',exact:true}).click();
  const md=await waiting;expect(await readFile((await md.path())!,'utf8')).toContain('规则演示（Mock）');
  waiting=page.waitForEvent('download');await page.getByRole('button',{name:'导出 JSON 备份',exact:true}).click();
  const downloaded=await waiting; const path=(await downloaded.path())!;
  const json=JSON.parse(await readFile(path,'utf8'));
  expect(json.cards[0].revision).toBe(2);expect(json.selectedEvidence).toEqual([]);expect(json).not.toHaveProperty('messages');
  await page.reload();await page.getByRole('button',{name:/本设备档案/}).click();
  await page.locator('input[type=file]').setInputFiles({name:'面包备份.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(json))});
  await page.getByRole('dialog').getByRole('button',{name:/只留下未知，明天再看/}).click();
  await page.getByRole('button',{name:'继续看这道题',exact:true}).click();
  await expect(page.getByRole('log')).toContainText('这是一次新的临时会话');
  await page.getByRole('button',{name:'结束',exact:true}).click();
  await page.getByRole('button',{name:'本设备档案',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:/只留下未知，明天再看/}).click();
  await page.getByRole('button',{name:'今天聊别的',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'写给面包',exact:true})).toBeVisible();
  await expect(page.getByRole('log')).not.toContainText('刚收到拒信');
});
