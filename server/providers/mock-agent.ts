import type { Card, Finding, TurnCandidate, TurnRequest } from '@/domain/types';
import { firstReference } from '@/domain/evidence';
import { needsImmediateSupport, SUPPORT_TEXT } from '@/domain/policy';
import type { AgentProvider } from './agent';

export function mockCandidate(input: TurnRequest): TurnCandidate {
  const base: TurnCandidate = { requestId: input.requestId, sessionId: input.sessionId, runId: input.runId, epoch: input.epoch, contextRevision: input.contextRevision, assistantText: '', findings: [], warnings: ['当前为规则演示，开放话题理解有限。'], serviceMode: 'mock' };
  if (needsImmediateSupport(input.userMessage)) return { ...base, assistantText: SUPPORT_TEXT, supportGuidance: true };
  if (input.mode === 'listen') {
    const text = /准备了三天/.test(input.userMessage) ? '准备了三天，最后却只得到很简短的回复。你现在最想说的是这个结果，还是面试里某个一直放不下的片段？'
      : /不想.*(复盘|分析)/.test(input.userMessage) ? '好，今晚不做分析。可以继续说，也可以停在这里。'
      : /benchmark|科研绘图/.test(input.userMessage) ? '那道题让你挂心。我们还不知道它是否影响了结果。你想先说说当时的感受吗？'
      : /拒信|被拒|不合适/.test(input.userMessage) ? '收到了不想看到的结果。你现在最想说的是哪一部分？'
      : '我看到了你写下的内容。规则演示还不能理解所有细节，你可以继续补充，或选择把原话留成一个记号。';
    return { ...base, assistantText: text };
  }
  const eligible = input.context.sources.filter(s => s.confirmed && s.text.trim().length > 5 && s.label !== '本次请求');
  if (!eligible.length) return { ...base, assistantText: input.mode === 'organize' ? '可以先写下一件你最在意的事，再留个记号。' : '先提供岗位类别和一小段当时的回答吧。材料可以省去公司名称；添加后请核对并确认表述。我们暂时不知道拒绝原因。' };
  const source = [...eligible].reverse().find(s => s.label !== '本次请求') ?? eligible[eligible.length - 1];
  const prefix = input.runId;
  const fact: Finding = { id: `${prefix}_fact`, kind: 'reported_fact', text: `你提供的${source.origin === 'user_recollection' ? '回忆' : '材料'}：${source.text.slice(0, 150)}`, evidenceRefs: [firstReference(source)], validity: 'draft' };
  const unknown: Finding = { id: `${prefix}_unknown`, kind: 'unknown', text: '当前材料不能说明招聘方完整的判断，也不能确定这次拒绝的原因。', evidenceRefs: [], validity: 'draft' };
  const findings: Finding[] = [fact, unknown];
  const sections: Card['sections'] = [
    { key: input.mode === 'organize' ? '我最在意的一件事' : '提供的内容', text: source.text.slice(0, 300), findingIds: [fact.id] },
    { key: '目前不知道的事', text: unknown.text, findingIds: [unknown.id] },
  ];
  if (input.mode !== 'organize') {
    const f: Finding = { id: `${prefix}_practice`, kind: 'practice_suggestion', text: input.mode === 'practice' ? `材料有限，以下是通用练习建议：围绕“${input.context.selectedQuestion}”，用你确实做过的事，检查${(input.context.practiceCriteria ?? []).join('、')}。没有提供的数据先留空，不编造。` : '材料有限，可以选一个通用练习方向：把“我做了什么—如何判断做得好—哪里仍不确定”讲清楚。这是训练建议，不是拒因判断。', evidenceRefs: [firstReference(source)], validity: 'draft' };
    findings.push(f); sections.push({ key: input.mode === 'practice' ? '这次练习' : '可选的一个练习', text: f.text, findingIds: [f.id] });
  } else sections.push({ key: '以后想看的问题', text: '', findingIds: [] }, { key: '我选择的下一步', text: '', findingIds: [] });
  const card: Card = { id: `${prefix}_card`, caseId: input.sessionId, revision: 1, parentRevision: null, type: input.mode === 'organize' ? 'note' : 'review', title: input.mode === 'organize' ? '今晚，先留一个记号' : input.mode === 'practice' ? '这一题，慢慢来' : '从一段真实回答开始', sections, validity: 'draft', createdAt: new Date().toISOString(), serviceMode: 'mock' };
  return { ...base, assistantText: input.mode === 'organize' ? '把你提供的原话留成了一个草稿。可以改字、删去不想留的内容，再决定是否确认和保存。' : '我把材料和未知分开放好了。右侧是待核对的草稿；通用练习建议不代表招聘方的判断。', findings, cardDraft: card };
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
