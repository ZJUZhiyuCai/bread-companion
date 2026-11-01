import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { BreadController } from '@/services/bread-controller';
import { explicitIntent, isActionOnly } from '@/domain/policy';
import { buildTurn, CONTEXT_LIMITS } from '@/domain/context-builder';
import { currentCard, initialState, reducer } from '@/domain/reducer';
import { validateCandidate } from '@/domain/evidence';
import { savedCaseSchema, turnRequestSchema } from '@/domain/schemas';
import { mockCandidate } from '@/server/providers/mock-agent';
import { requestFixture, sampleSource } from '@/fixtures/scenarios';
import { fromSnapshot, parseImport } from '@/services/card-store';
import { toMarkdown } from '@/services/export';
import type { TurnRequest } from '@/domain/types';

function withCard() {
  return reducer({ ...initialState('session_test', 'case_test'), started: true, mode: 'review', sources: [sampleSource], activeRunId: 'run_test' }, { type: 'CANDIDATE', candidate: mockCandidate(requestFixture()) });
}
const positives = ['现在我想复盘了', '我现在想复盘一下', '可以帮我看看刚才那段回答吗？'];
describe('explicit user control across generation and storage', () => {
  it.each(positives)('routes %s to review without treating a pure request as evidence', text => {
    expect(explicitIntent(text)).toBe('review'); expect(isActionOnly(text)).toBe(true);
  });
  it('preserves material attached to a direct request and excludes quoted/uncertain consent', () => {
    const text = '现在我想复盘了。这是面试中的一段原话：我做了十个样例。';
    expect(explicitIntent(text)).toBe('review'); expect(isActionOnly(text)).toBe(false);
    expect(explicitIntent('我现在不想复盘了')).toBe('listen');
    for (const text of ['面试官说“你应该复盘”', '“现在我想复盘了”是他的话', '如果我现在想复盘一下', '我不确定是否想复盘']) expect(explicitIntent(text)).toBeNull();
  });
  it('button and free text generate the same card type; redo direction is not evidence', async () => {
    const requests: TurnRequest[] = [];
    const make = () => new BreadController(async (_url, init) => { const input = JSON.parse(init!.body as string); requests.push(input); return Response.json(mockCandidate(input)); });
    for (const text of [...positives, 'button']) {
      const c = make(); c.addMaterial(sampleSource.text);
      if (text === 'button') await c.assist('review'); else await c.send(text);
      expect(c.getSnapshot().currentCard?.type).toBe('review');
      await c.assist('review', '更具体一点，别把这一段当成我的全部能力');
      expect(requests.at(-1)?.userMessage).toContain('本次修改方向（用户说明）');
      expect(requests.at(-1)?.context.sourceSegments?.some(s => s.text.includes('更具体一点'))).toBe(false);
      c.dispose();
    }
  });
  it('carries rejected judgment and original revision after correction, omits old analysis, clears on end', () => {
    let state = withCard(); const rejected = state.findings[0];
    state = reducer(state, { type: 'REJECT', id: rejected.id });
    expect(currentCard(state)?.validity).toBe('disputed');
    state = reducer(state, { type: 'CORRECT_SOURCE', id: sampleSource.id, text: '实际上是十个例子。' });
    const turn = buildTurn(state, '现在我想复盘了', 'next', 'next_request');
    expect(turn.context.rejectedFindings?.[0]).toMatchObject({ text: rejected.text, mode: 'review', sources: [{sourceId: sampleSource.id, sourceRevision: 1}] });
    expect(turn.context.sourceSegments?.[0].sourceRevision).toBe(2);
    expect(turn.context.recentMessages.some(m => m.role === 'assistant')).toBe(false);
    expect(reducer(state, { type: 'END' }).rejectedFindings).toEqual([]);
  });
  it('acknowledges a rejection once while retaining it as a constraint', () => {
    let state = withCard();
    state = reducer(state, {type: 'REJECT', id: state.findings[0].id});
    expect(state.rejectedFindings?.[0].needsAcknowledgement).toBe(true);
    state = reducer(state, {type: 'RUN', runId: 'second', activity: 'generating'});
    const input = buildTurn(state, '重新整理', 'second', 'next');
    state = reducer(state, {type: 'CANDIDATE', candidate: mockCandidate(input)});
    expect(state.rejectedFindings?.[0].needsAcknowledgement).toBe(false);
    expect(buildTurn(state, '继续', 'third', 'third_request').context.rejectedFindings).toHaveLength(1);
  });
  it('blocks exact repeated findings and Mock removes their dependent sections', () => {
    const input = requestFixture(); const first = mockCandidate(input);
    input.context.rejectedFindings = [{text: first.findings[2].text, mode: 'review', sources: []}];
    expect(validateCandidate(first, input)).toContain('REJECTED_FINDING_REPEATED');
    const redo = mockCandidate(input);
    expect(validateCandidate(redo, input)).toEqual([]);
    expect(redo.findings.some(f => f.text === first.findings[2].text)).toBe(false);
    expect(redo.cardDraft?.sections.some(s => s.findingIds.includes(first.findings[2].id))).toBe(false);
  });
  it('bounds correction history and the request even with maximal Chinese payloads', () => {
    let state = withCard();
    for (let i = 0; i < 8; i++) {
      state.findings.push({ ...state.findings[0], id: `reject_${i}`, text: `${i}${'长'.repeat(1499)}` });
      state = reducer(state, { type: 'REJECT', id: `reject_${i}` });
    }
    expect(state.rejectedFindings).toHaveLength(4);
    state.selectedQuestion = '问'.repeat(1000); state.practiceCriteria = ['甲'.repeat(100), '乙'.repeat(100)];
    const turn = buildTurn(state, '字'.repeat(4000), 'next', 'next_request');
    expect(turnRequestSchema.safeParse(turn).success).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(turn)).byteLength).toBeLessThanOrEqual(CONTEXT_LIMITS.wireBytes);
    expect(turn.context.rejectedFindings?.at(-1)?.text).toBe(`7${'长'.repeat(1499)}`);
  });
  it('preserves edit provenance through preview snapshot, JSON import and Markdown', () => {
    let state = withCard(); const card = currentCard(state)!;
    state = reducer(state, { type: 'EDIT_CARD', title: '我补写的标题', sections: card.sections.map((s,i) => i ? s : { ...s, text: '我补写：做了九十九个例子。' }) });
    expect(currentCard(state)?.sections[0].userEdited).toBe(true);
    expect(currentCard(state)?.sections[1].userEdited).toBe(false);
    expect(currentCard(state)?.sections[0].findingIds).toEqual(card.sections[0].findingIds);
    state = reducer(state, { type: 'CONFIRM_CARD' }); state = reducer(state, { type: 'END' });
    const archive = fromSnapshot(state.endSnapshot!);
    expect(savedCaseSchema.safeParse(archive).success).toBe(true);
    const imported = parseImport(JSON.stringify(archive));
    expect(imported.cards[0].titleUserEdited).toBe(true); expect(imported.cards[0].sections[0].userEdited).toBe(true);
    expect(toMarkdown(imported)).toContain('原版依据，不自动支持补写');
    expect(imported.selectedEvidence.some(e => e.quote.includes('九十九'))).toBe(false);
    expect(savedCaseSchema.safeParse({...archive, cards: [card]}).success).toBe(true);
  });
});
