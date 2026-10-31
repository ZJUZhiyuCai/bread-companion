import { describe, expect, it } from 'vitest';
import { currentCard, initialState, isCurrent, reducer } from '@/domain/reducer';
import { cardCanConfirm, firstReference, locateEvidence, segments, validateCandidate } from '@/domain/evidence';
import { explicitIntent, needsImmediateSupport } from '@/domain/policy';
import { candidateSchema } from '@/domain/schemas';
import { buildTurn, selectSegments } from '@/domain/context-builder';
import { mockCandidate } from '@/server/providers/mock-agent';
import { requestFixture, sampleSource, scenarios } from '@/fixtures/scenarios';

function withCard() {
  let s = initialState('session_test', 'case_test');
  s = { ...s, started: true, mode: 'review', sources: [sampleSource], activeRunId: 'run_test' };
  return reducer(s, { type: 'CANDIDATE', candidate: mockCandidate(requestFixture()) });
}
describe('controller authority and evidence', () => {
  it('repeated action requests do not crowd interview evidence out of the context window', () => {
    const state=initialState();state.sources=[sampleSource,...Array.from({length:30},(_,i)=>({...sampleSource,id:`request_source_${i}`,label:'本次请求',text:'陪我练一题，请根据我们聊过的内容选一个问题。'}))];
    const turn=buildTurn(state,'陪我练一题','run_next','request_next');
    expect(turn.context.sources).toEqual([sampleSource]);expect(selectSegments(state.sources,'陪我练一题').every(s=>s.sourceId===sampleSource.id)).toBe(true);
  });
  it('negation/quotation is not review consent', () => {
    expect(explicitIntent('请直接复盘')).toBe('review'); expect(explicitIntent('今晚不想复盘')).toBe('listen');
    expect(explicitIntent('我不知道要不要复盘')).toBeNull(); expect(explicitIntent('他让我复盘')).toBeNull();
    expect(explicitIntent('停止')).toBe('stop');
  });
  it('understands direct conversational actions without treating quotations or uncertainty as consent', () => {
    expect(explicitIntent('帮我复盘一下刚才的面试片段。')).toBe('review');
    expect(explicitIntent('陪我练一题，请根据我们聊过的内容选一个问题。')).toBe('practice');
    expect(explicitIntent('帮我把刚才说的留个记号。')).toBe('organize');
    expect(explicitIntent('我现在不想分析了，只想说说。')).toBe('listen');
    expect(explicitIntent('先别复盘了')).toBe('listen');expect(explicitIntent('不练了')).toBe('listen');
    expect(explicitIntent('我们练习过三次，都没有记录数据。')).toBeNull();
    expect(explicitIntent('我不知道该不该练习')).toBeNull();
    expect(explicitIntent('“帮我复盘一下”是他发来的话')).toBeNull();
    expect(explicitIntent('如果我说帮我复盘呢')).toBeNull();
  });
  it('only accepts a practice plan in a requested preparation turn', () => {
    const input = requestFixture({ mode: 'practice' });
    const plan = mockCandidate(input);
    expect(plan.practiceSetup?.criteria.length).toBeGreaterThan(0);
    expect(validateCandidate(plan,input)).toEqual([]);
    expect(validateCandidate(plan,{...input,mode:'listen'})).toContain('PRACTICE_SETUP_NOT_REQUESTED');
    expect(validateCandidate({...plan,practiceSetup:undefined},input)).toContain('PRACTICE_SETUP_REQUIRED');
    expect(validateCandidate({...plan,findings:mockCandidate(requestFixture()).findings},input)).toContain('PRACTICE_ANSWER_REQUIRED');
  });
  it('uses exact revision and segment with Chinese and emoji', () => {
    const s = { ...sampleSource, text: '中'.repeat(499) + '🥯你好👩‍💻' };
    const seg = segments(s); expect(seg[0].text.endsWith('🥯')).toBe(true);
    const ref = { ...firstReference(s), quote: '🥯', segmentId: seg[0].id };
    expect(locateEvidence([s], ref)).toBe(true); expect(locateEvidence([{ ...s, revision: 2 }], ref)).toBe(false);
    expect(locateEvidence([s], { ...ref, quote: '不存在' })).toBe(false);
  });
  it('source correction invalidates findings, cards, and in-flight runs', () => {
    let s = withCard(); s = reducer(s, { type: 'CONFIRM_CARD' });
    expect(currentCard(s)?.validity).toBe('confirmed');
    s = reducer(s, { type: 'RUN', runId: 'old', activity: 'generating' });
    const token = { sessionId: s.sessionId, runId: 'old', epoch: s.epoch, contextRevision: s.contextRevision };
    s = reducer(s, { type: 'CORRECT_SOURCE', id: sampleSource.id, text: '其实是十个例子。' });
    expect(s.sources[0].revision).toBe(2); expect(s.sources[0].confirmed).toBe(true);
    expect(currentCard(s)?.validity).toBe('stale'); expect(isCurrent(s, token)).toBe(false);
    expect(cardCanConfirm(currentCard(s)!, s.findings, s.sources)).toBe(false);
    expect(reducer(s, { type: 'CONFIRM_CARD' })).toBe(s);
  });
  it('rejected inference invalidates its card', () => {
    let s = withCard(); s = reducer(s, { type: 'REJECT', id: s.findings[0].id });
    expect(s.findings[0].validity).toBe('disputed'); expect(currentCard(s)?.validity).toBe('disputed');
  });
  it('end clears raw data, freezes only confirmed linked evidence, and discards late result', () => {
    let s = withCard(); s = reducer(s, { type: 'CONFIRM_CARD' });
    s = reducer(s, { type: 'END' });
    expect(s.sources).toEqual([]); expect(s.messages).toEqual([]); expect(s.findings).toEqual([]);
    expect(s.endSnapshot?.card.validity).toBe('confirmed'); expect(s.endSnapshot?.evidence[0].origin).toBe('user_recollection');
    expect(reducer(s, { type: 'CANDIDATE', candidate: mockCandidate(requestFixture()) })).toBe(s);
    expect(reducer(s, { type: 'MODE', mode: 'practice' })).toBe(s);
    expect(reducer(s, { type: 'DELETE_CASE', caseId: s.caseId }).endSnapshot).toBeNull();
  });
  it('end preserves only a previously displayed valid draft, without accepting or fabricating it', () => {
    const ended=reducer(withCard(), { type:'END' });
    expect(ended.endSnapshot?.card.validity).toBe('draft'); expect(ended.sources).toEqual([]);
    expect(reducer(initialState(), {type:'END'}).endSnapshot).toBeNull();
    const stale=reducer(withCard(), {type:'CORRECT_SOURCE',id:sampleSource.id,text:'改正后的内容。'});
    expect(reducer(stale,{type:'END'}).endSnapshot).toBeNull();
  });
  it('new generations continue the case revision sequence after user edits', () => {
    let s = withCard(); const first = currentCard(s)!;
    s = reducer(s, {type:'EDIT_CARD', title:'修改后的标题', sections:first.sections});
    expect(currentCard(s)?.revision).toBe(2);
    s = reducer(s, {type:'RUN',runId:'run_next',activity:'generating'});
    s = reducer(s, {type:'CANDIDATE',candidate:mockCandidate(requestFixture({runId:'run_next'}))});
    expect(currentCard(s)?.revision).toBe(3); expect(currentCard(s)?.parentRevision).toBe(2);
  });
  it('deleting or clearing a card section also removes its saved evidence', () => {
    const state = withCard(); const card = currentCard(state)!;
    let edited = reducer(state, { type:'EDIT_CARD', title:card.title, sections:card.sections.filter(s=>s.key==='目前不知道的事') });
    expect(currentCard(edited)?.sections).toHaveLength(1);
    edited=reducer(edited,{type:'CONFIRM_CARD'});edited=reducer(edited,{type:'END'});
    expect(edited.endSnapshot?.evidence).toEqual([]);
    let empty=reducer(state,{type:'EDIT_CARD',title:'只留标题',sections:[]});empty=reducer(empty,{type:'CONFIRM_CARD'});empty=reducer(empty,{type:'END'});
    expect(empty.endSnapshot?.card.sections).toEqual([]);expect(empty.endSnapshot?.findings).toEqual([]);
  });
  it('stop is resumable while old tokens remain invalid', () => {
    const s = { ...initialState('session_test'), activeRunId: 'run_test' };
    const stopped = reducer(s, { type: 'STOP' }); expect(stopped.lifecycle).toBe('active');
    expect(reducer(stopped, { type: 'CANDIDATE', candidate: mockCandidate(requestFixture()) })).toBe(stopped);
  });
  it('rejects model authority escalation and invented quotes', () => {
    const input = requestFixture(); const bad = mockCandidate(input); bad.findings[0].evidenceRefs[0].quote = '我提高了 99%';
    expect(validateCandidate(bad, input)).toContain('EVIDENCE_MISMATCH');
    expect(validateCandidate(mockCandidate(input), { ...input, mode: 'listen' })).toContain('MODE_VIOLATION');
    const confirmed = mockCandidate(input); confirmed.findings[0].validity = 'confirmed'; expect(validateCandidate(confirmed, input)).toContain('MODEL_CANNOT_CONFIRM');
  });
  it('requires explicit source confirmation before review', () => {
    const input = requestFixture(); const candidate = mockCandidate(input); input.context.sources = [{ ...sampleSource, confirmed: false }];
    expect(validateCandidate(candidate, input)).toContain('EVIDENCE_MISMATCH');
  });
  it('does not equate negation, quotations or old events with immediate risk', () => {
    expect(needsImmediateSupport('我不会伤害自己，只是难过')).toBe(false);
    expect(needsImmediateSupport('朋友说“我想自杀”')).toBe(false); expect(needsImmediateSupport('我去年想自杀')).toBe(false);
    expect(needsImmediateSupport('我现在准备伤害自己')).toBe(true);
  });
  it.each(scenarios)('Mock fixture remains schema and evidence valid: %s / %s', (mode, userMessage) => {
    const input = requestFixture({ mode, userMessage, context: { summary: '', recentMessages: [], sources: [sampleSource], ...(mode === 'practice' ? { selectedQuestion: '如何定义 benchmark？', practiceCriteria: ['评价标准'] } : {}) } });
    const c = candidateSchema.parse(mockCandidate(input)); expect(validateCandidate(c, input)).toEqual([]);
    if (mode === 'listen') expect(c.cardDraft).toBeUndefined();
  });
});
