import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { BreadController } from '@/services/bread-controller';
import { mockCandidate } from '@/server/providers/mock-agent';
import type { TurnRequest } from '@/domain/types';
import { listSaved } from '@/services/card-store';
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
