import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CallRoom } from '@/components/CallRoom';
import { ModeBar } from '@/components/ModeBar';
import { initialState, reducer } from '@/domain/reducer';
import type { CallPhase, Card } from '@/domain/types';
import { BreadController } from '@/services/bread-controller';

const noop = () => {};
const base = new BreadController().getSnapshot();
const started = reducer(initialState(), { type: 'START_INTERVIEW' });
const debriefCard: Card = {
  id: 'review_card', caseId: started.caseId, revision: 1, parentRevision: null,
  type: 'review', title: '这场模拟的小复盘', sections: [], validity: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z', serviceMode: 'mock',
};

function snapshot(phase: CallPhase, debrief = false, currentCard: Card | null = null, busy = false) {
  const state = { ...started, interview: { ...started.interview!, round: 1,
    stage: debrief ? 'debrief' as const : 'question' as const, currentQuestion: debrief ? '' : '如何验证？' } };
  return { ...base, state, currentCard, busy, call: { ...base.call, active: true, phase } };
}

function callRoom(vm = snapshot('listening'), card: Card | null = null) {
  return renderToStaticMarkup(createElement(CallRoom, { vm, wide: true, debriefCard: card, onHangup: noop, onOpenDebriefCard: noop }));
}

function modeBar(vm = snapshot('idle'), card: Card | null = null) {
  return renderToStaticMarkup(createElement(ModeBar, { vm, debriefCard: card, canAct: true, show: true,
    onAssist: noop, onBackToTalk: noop, onAdjustPractice: noop }));
}

describe('interview call and ticket actions', () => {
  it.each(['connecting', 'transcribing', 'paused', 'error', 'listening'] as const)('renders the appropriate style availability during %s', phase => {
    const buttons = callRoom(snapshot(phase)).match(/<button[^>]*interview-style__choice[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons.map(button => button.includes('disabled=""'))).toEqual(Array(2).fill(phase !== 'listening'));
  });

  it('offers a retry in the call and the text ticket when this debrief has no card', () => {
    const unrelated = { ...debriefCard, id: 'previous_card' };
    for (const html of [callRoom(snapshot('listening', true, unrelated)), modeBar(snapshot('idle', true, unrelated))]) {
      expect(html).toContain('重试复盘');
      expect(html).toContain('再练一场');
      expect(html).not.toContain('查看并保存复盘卡');
    }
    expect(modeBar(snapshot('idle', true, null, true))).toMatch(/<button[^>]*disabled=""[^>]*>重试复盘<\/button>/);
  });

  it.each(['stale', 'disputed'] as const)('only offers to rebuild a %s debrief card', validity => {
    const card = { ...debriefCard, validity };
    const html = callRoom(snapshot('listening', true, card), card);
    expect(html).toContain('引用的材料或判断已改动，这张复盘卡需要重新整理。');
    expect(html).toContain('重新复盘');
    expect(html).not.toContain('查看并保存复盘卡');
    expect(callRoom(snapshot('listening', true, debriefCard), debriefCard)).toContain('查看并保存复盘卡');
    expect(modeBar(snapshot('idle', true, card), card)).toContain('重新复盘');
  });
});
