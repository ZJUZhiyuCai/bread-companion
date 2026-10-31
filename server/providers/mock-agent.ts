import type { Card, Finding, TurnCandidate, TurnRequest } from '@/domain/types';
import { requestSegments } from '@/domain/context-builder';
import { needsImmediateSupport, SUPPORT_TEXT } from '@/domain/policy';
import type { AgentProvider } from './agent';

export function mockCandidate(input: TurnRequest): TurnCandidate {
  const evidence = requestSegments(input);
  const base: TurnCandidate = { requestId: input.requestId, sessionId: input.sessionId, runId: input.runId, epoch: input.epoch, contextRevision: input.contextRevision, assistantText: '', findings: [], warnings: ['当前为规则演示，开放话题理解有限。'], serviceMode: 'mock' };
  if (needsImmediateSupport(input.userMessage)) return { ...base, assistantText: SUPPORT_TEXT, supportGuidance: true };
  if (input.mode === 'practice' && !input.context.selectedQuestion) {
    const material = evidence.filter(s => s.confirmed && s.label !== '本次请求').map(s => s.text).join('\n');
    const question = /benchmark|评测|Agent/i.test(material) ? '讲讲你怎样判断这个 Agent 的效果。你做了什么验证，还有哪些地方不确定？' : '选一个你确实参与过的项目，说说你负责什么，以及怎样判断做得好不好。';
    return { ...base, assistantText: `就从这一题开始：${question} 按你平常说话的方式回答就好，也可以让我换一道。`, practiceSetup: { question, criteria: ['说清自己做了什么', '用真实例子说明判断依据'] } };
  }
  if (input.mode === 'listen') {
    const text = /准备了三天/.test(input.userMessage) ? '准备了三天，最后却只得到很简短的回复。你现在最想说的是这个结果，还是面试里某个一直放不下的片段？'
      : /不想.*(复盘|分析)/.test(input.userMessage) ? '好，今晚不做分析。可以继续说，也可以停在这里。'
      : /benchmark|科研绘图/.test(input.userMessage) ? '那道题让你挂心。我们还不知道它是否影响了结果。你想先说说当时的感受吗？'
      : /拒信|被拒|不合适/.test(input.userMessage) ? '收到了不想看到的结果。你现在最想说的是哪一部分？'
      : '我看到了你写下的内容。规则演示还不能理解所有细节，你可以继续补充，或选择把原话留成一个记号。';
    return { ...base, assistantText: text };
  }
  const eligible = evidence.filter(s => s.confirmed && s.text.trim().length > 5 && s.label !== '本次请求');
  if (!eligible.length) return { ...base, assistantText: input.mode === 'organize' ? '可以先写下一件你最在意的事，再留个记号。' : '我们先看一个片段就好。面试里哪道题让你一直挂心？可以直接写下当时怎么问、你怎么答，不用整理完整。' };
  const source = eligible.find(s => input.userMessage.includes(s.text)) ?? eligible[0];
  const reference = { sourceId: source.sourceId, sourceRevision: source.sourceRevision, segmentId: source.segmentId, quote: Array.from(source.text).slice(0, 200).join('') };
  const prefix = input.runId;
  const fact: Finding = { id: `${prefix}_fact`, kind: 'reported_fact', text: `你提供的${source.origin === 'user_recollection' ? '回忆' : '材料'}：${source.text.slice(0, 150)}`, evidenceRefs: [reference], validity: 'draft' };
  const unknown: Finding = { id: `${prefix}_unknown`, kind: 'unknown', text: '当前材料不能说明招聘方完整的判断，也不能确定这次拒绝的原因。', evidenceRefs: [], validity: 'draft' };
  const findings: Finding[] = [fact, unknown];
  const sections: Card['sections'] = [
    { key: input.mode === 'organize' ? '我最在意的一件事' : '提供的内容', text: source.text.slice(0, 300), findingIds: [fact.id] },
    { key: '目前不知道的事', text: unknown.text, findingIds: [unknown.id] },
  ];
  if (input.mode !== 'organize') {
    const f: Finding = { id: `${prefix}_practice`, kind: 'practice_suggestion', text: input.mode === 'practice' ? `材料有限，以下是通用练习建议：围绕“${input.context.selectedQuestion}”，用你确实做过的事，检查${(input.context.practiceCriteria ?? []).join('、')}。没有提供的数据先留空，不编造。` : '材料有限，可以选一个通用练习方向：把“我做了什么—如何判断做得好—哪里仍不确定”讲清楚。这是训练建议，不是拒因判断。', evidenceRefs: [reference], validity: 'draft' };
    findings.push(f); sections.push({ key: input.mode === 'practice' ? '这次练习' : '可选的一个练习', text: f.text, findingIds: [f.id] });
  } else sections.push({ key: '以后想看的问题', text: '', findingIds: [] }, { key: '我选择的下一步', text: '', findingIds: [] });
  const card: Card = { id: `${prefix}_card`, caseId: input.sessionId, revision: 1, parentRevision: null, type: input.mode === 'organize' ? 'note' : 'review', title: input.mode === 'organize' ? '今晚，先留一个记号' : input.mode === 'practice' ? '这一题，慢慢来' : '从一段真实回答开始', sections, validity: 'draft', createdAt: new Date().toISOString(), serviceMode: 'mock' };
  return { ...base, assistantText: input.mode === 'organize' ? '把你提供的原话留成了一个草稿。可以改字、删去不想留的内容，再决定是否确认和保存。' : '这段回答里有值得留下的部分。先只看一个可以说得更清楚的地方，卡片放在下面，你可以改，也可以先不留。', findings, cardDraft: card };
}
export class MockProvider implements AgentProvider {
  constructor(private delay = 400) {}
  async generate(input: TurnRequest, signal: AbortSignal): Promise<TurnCandidate> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, this.delay);
      signal.addEventListener('abort', abort, { once: true });
    });
    signal.throwIfAborted(); return mockCandidate(input);
  }
}
