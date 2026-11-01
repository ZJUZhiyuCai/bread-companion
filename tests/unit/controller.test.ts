import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { BreadController } from '@/services/bread-controller';
import { mockCandidate } from '@/server/providers/mock-agent';
import type { TurnRequest } from '@/domain/types';
import { listSaved } from '@/services/card-store';
import { getCapabilities } from '@/server/config';
describe('late asynchronous work', () => {
  it('ending before a provider returns publishes nothing and erases raw text', async () => {
    let finish!: (res:Response)=>void;let input!:TurnRequest;
    const fetcher=vi.fn((_url:RequestInfo|URL,init?:RequestInit)=>{input=JSON.parse(init!.body as string);return new Promise<Response>(r=>{finish=r;});});
    const controller=new BreadController(fetcher);controller.start('listen');
    const pending=controller.send('刚收到拒信。');controller.end();finish(Response.json(mockCandidate(input)));await pending;
    expect(controller.getSnapshot().state.lifecycle).toBe('ended');expect(controller.getSnapshot().state.messages).toEqual([]);expect(controller.getSnapshot().state.sources).toEqual([]);expect(controller.getSnapshot().error).toBe('');
  });
  it('a source correction wins over an old candidate even if fetch ignores abort', async () => {
    let finish!:(res:Response)=>void;let input!:TurnRequest;
    const fetcher=vi.fn((_url:RequestInfo|URL,init?:RequestInit)=>{input=JSON.parse(init!.body as string);return new Promise<Response>(r=>{finish=r;});});
    const c=new BreadController(fetcher);c.start('review');const pending=c.send('应聘产品工程，我说做了二十个例子。');
    c.correctSource(c.getSnapshot().state.sources[0].id,'实际上只有十个例子。');finish(Response.json(mockCandidate(input)));await pending;
    expect(c.getSnapshot().currentCard).toBeNull();expect(c.getSnapshot().state.sources[0].revision).toBe(2);
  });
  it('a new controller has no temporary conversation after refresh', async () => {
    const c=new BreadController(async(_url,init)=>Response.json(mockCandidate(JSON.parse(init!.body as string))));c.start();await c.send('临时敏感内容');
    const fresh=new BreadController();expect(fresh.getSnapshot().state.sources).toEqual([]);expect(fresh.getSnapshot().state.messages).toEqual([]);
  });
  it('explicit refusal cancels pending analysis and changes mode to listen', async () => {
    const c=new BreadController(async(_url,init)=>Response.json(mockCandidate(JSON.parse(init!.body as string))));c.start('review');await c.send('今晚不想复盘');
    expect(c.getSnapshot().state.mode).toBe('listen');expect(c.getSnapshot().currentCard).toBeNull();
  });
  it('an already selected confirmed save survives ending the Agent session', async () => {
    const c=new BreadController(async(_url,init)=>Response.json(mockCandidate(JSON.parse(init!.body as string))));
    c.start('review');await c.send('应聘产品工程，我说做了二十个例子，再人工检查图。');c.confirmCard();
    const id=c.getSnapshot().state.caseId;const saving=c.saveCard();c.end();await saving;
    expect((await listSaved()).some(s=>s.caseId===id)).toBe(true);
    expect(c.getSnapshot().state.messages).toEqual([]);
  });
  it('a pending local save cannot resurrect a corrected source', async () => {
    const c=new BreadController(async(_url,init)=>Response.json(mockCandidate(JSON.parse(init!.body as string))));
    c.start('review');await c.send('应聘产品工程，我说做了二十个例子，再人工检查图。');c.confirmCard();
    const id=c.getSnapshot().state.caseId;const saving=c.saveCard();c.correctSource(c.getSnapshot().state.sources[0].id,'其实是十个例子。');await saving;
    expect((await listSaved()).some(s=>s.caseId===id)).toBe(false);
    expect(c.getSnapshot().error).toContain('失效');
  });
});


describe('agent handles preparation', () => {
  const controller = () => new BreadController(async (_url,init) => Response.json(mockCandidate(JSON.parse(init!.body as string))));
  it('prepares one question from submitted material, then evaluates the actual answer', async () => {
    const c=controller(); c.addMaterial('岗位是产品工程，面试问 Agent benchmark，我说只有十个样例。');
    await c.assist('practice');
    const setup=c.getSnapshot();
    expect(setup.error).toBe('');expect(setup.state.started).toBe(true);
    expect(setup.state.mode).toBe('practice');expect(setup.state.selectedQuestion).toContain('Agent');
    expect(setup.state.practiceCriteria).toHaveLength(2);expect(setup.currentCard).toBeNull();
    await c.send('我做了十个真实样例，人工检查成功与失败，复杂输入还没有覆盖。');
    expect(c.getSnapshot().currentCard?.type).toBe('review');
    expect(c.getSnapshot().state.findings[0].evidenceRefs[0].quote).toContain('十个真实样例');
  });
  it('keeps interview content supplied in the same sentence as a request', async () => {
    const c=controller(); await c.send('帮我复盘：产品工程面试，我说做了十个例子，但没有讲评测标准。');
    expect(c.getSnapshot().state.mode).toBe('review');expect(c.getSnapshot().currentCard).not.toBeNull();
    expect(c.getSnapshot().state.findings[0].evidenceRefs[0].quote).toContain('十个例子');
  });
  it('saves a displayed valid draft in one explicit action; creation alone does not persist', async () => {
    const c=controller(); c.addMaterial('面试岗位是产品工程，我说明了十个测试案例和人工检查。');
    await c.assist('review');const id=c.getSnapshot().state.caseId;
    expect(c.getSnapshot().currentCard?.validity).toBe('draft');
    expect((await listSaved()).some(s=>s.caseId===id)).toBe(false);
    await c.saveCard();
    expect(c.getSnapshot().error).toBe('');expect((await listSaved()).find(s=>s.caseId===id)?.cards[0].validity).toBe('confirmed');
  });
  it('a corrected statement is immediately usable, while its old card remains invalid', async () => {
    const c=controller();c.addMaterial('产品工程面试：我做了二十个例子。');await c.assist('review');
    const source=c.getSnapshot().state.sources[0];c.correctSource(source.id,'产品工程面试：其实做了十个例子。');
    expect(c.getSnapshot().currentCard?.validity).toBe('stale');
    await c.saveCard();expect(c.getSnapshot().error).not.toBe('');
    await c.assist('review');expect(c.getSnapshot().currentCard?.validity).toBe('draft');
    expect(c.getSnapshot().state.findings.at(-3)?.evidenceRefs[0].sourceRevision).toBe(2);
    await c.saveCard();expect(c.getSnapshot().error).toBe('');
  });
  it('can explicitly keep an existing draft after ending, without restoring raw conversation', async () => {
    const c=controller();c.addMaterial('产品工程面试，我做了十个测试案例，没有覆盖复杂情况。');await c.assist('review');
    const id=c.getSnapshot().state.caseId;c.end();
    expect(c.getSnapshot().currentCard?.validity).toBe('draft');expect((await listSaved()).some(s=>s.caseId===id)).toBe(false);
    await c.saveCard();expect(c.getSnapshot().error).toBe('');expect(c.getSnapshot().currentCard?.validity).toBe('confirmed');
    expect(c.getSnapshot().state.sources).toEqual([]);expect(c.getSnapshot().state.messages).toEqual([]);
    expect((await listSaved()).some(s=>s.caseId===id)).toBe(true);
  });
  it('supplies a default focus when a user changes just the question', () => {
    const c=controller();c.setPractice('介绍你实际做过的一个项目。',[]);
    expect(c.getSnapshot().state.selectedQuestion).not.toBe('');expect(c.getSnapshot().state.practiceCriteria).toHaveLength(1);expect(c.getSnapshot().error).toBe('');
  });
  it('ending during preparation cannot install a late question', async () => {
    let finish!:(r:Response)=>void;let input!:TurnRequest;
    const c=new BreadController(async(_url,init)=>{input=JSON.parse(init!.body as string);return new Promise<Response>(r=>{finish=r;});});
    const pending=c.assist('practice');c.end();finish(Response.json(mockCandidate(input)));await pending;
    expect(c.getSnapshot().state.selectedQuestion).toBe('');expect(c.getSnapshot().state.messages).toEqual([]);
  });
  it('resuming uses previously saved verbatim excerpts without another setup form', async () => {
    const c=controller();c.addMaterial('面试产品工程，我做了十个真实测试案例，结果仍需进一步核对。');
    await c.assist('review');await c.saveCard();const saved=(await listSaved()).find(s=>s.caseId===c.getSnapshot().state.caseId)!;
    const next=controller();next.resumeSaved(saved);
    expect(next.getSnapshot().state.caseId).not.toBe(saved.caseId);
    expect(next.getSnapshot().state.sources.every(s=>s.confirmed)).toBe(true);
    await next.assist('practice');expect(next.getSnapshot().state.selectedQuestion).not.toBe('');
  });
});


describe('recovering service readiness without losing the conversation', () => {
  it('recovers after a failed check without clearing another error or resending a turn', async () => {
    let checks = 0, turns = 0;
    const c = new BreadController(async url => {
      if (String(url).endsWith('/capabilities')) return ++checks === 1 ? new Response('', { status: 503 }) : Response.json(getCapabilities());
      turns++; return Response.json({ error: { userMessage: '回复暂时没接上。', retryable: true } }, { status: 503 });
    });
    await c.refreshCapabilities(); expect(c.getSnapshot().connectionError).not.toBe('');
    await c.send('这一句不能因为重连丢掉。');
    const before = c.getSnapshot().state.messages;
    expect(c.getSnapshot().canRetry).toBe(true);
    await c.refreshCapabilities();
    expect(c.getSnapshot().connectionError).toBe(''); expect(c.getSnapshot().capabilities).not.toBeNull();
    expect(c.getSnapshot().error).toBe('回复暂时没接上。'); expect(c.getSnapshot().canRetry).toBe(true);
    expect(c.getSnapshot().state.messages).toEqual(before); expect(turns).toBe(1); c.dispose();
  });
  it('coalesces concurrent reconnection attempts', async () => {
    let finish!: (r: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(r => { finish = r; }));
    const c = new BreadController(fetcher);
    const first = c.refreshCapabilities(); await c.refreshCapabilities();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(c.getSnapshot().connectionChecking).toBe(true);
    finish(Response.json(getCapabilities())); await first;
    expect(c.getSnapshot().connectionChecking).toBe(false); c.dispose();
  });
  it('rejects incomplete service metadata and permits recovery', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ agent: {} })).mockResolvedValueOnce(Response.json(getCapabilities()));
    const c = new BreadController(fetcher); await c.refreshCapabilities();
    expect(c.getSnapshot().capabilities).toBeNull(); expect(c.getSnapshot().connectionError).not.toBe('');
    await c.refreshCapabilities(); expect(c.getSnapshot().connectionError).toBe(''); c.dispose();
  });
  it('bounds a stalled check and leaves a usable retry', async () => {
    vi.useFakeTimers();
    const c = new BreadController(vi.fn().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(Response.json(getCapabilities())));
    try {
      const pending = c.refreshCapabilities(); await vi.advanceTimersByTimeAsync(8001); await pending;
      expect(c.getSnapshot().connectionChecking).toBe(false); expect(c.getSnapshot().connectionError).not.toBe('');
      await c.refreshCapabilities(); expect(c.getSnapshot().connectionError).toBe('');
    } finally { c.dispose(); vi.useRealTimers(); }
  });
  it('aborts a disposed check and ignores its late result after remount', async () => {
    let finish!: (r: Response) => void, oldSignal: AbortSignal;
    const fetcher = vi.fn().mockImplementationOnce((_url, init) => { oldSignal = init.signal; return new Promise<Response>(r => { finish = r; }); }).mockResolvedValueOnce(Response.json(getCapabilities()));
    const c = new BreadController(fetcher); const pending = c.refreshCapabilities(); c.dispose();
    expect(oldSignal!.aborted).toBe(true);
    await c.initialize(); const current = c.getSnapshot().capabilities;
    finish(Response.json({ agent: {} })); await pending;
    expect(c.getSnapshot().capabilities).toBe(current); expect(c.getSnapshot().connectionError).toBe(''); c.dispose();
  });
});
