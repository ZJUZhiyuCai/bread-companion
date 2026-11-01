import type { Activity, Card, EndSnapshot, Finding, Mode, RunToken, SessionState, Source, TurnCandidate } from './types';
import { cardCanConfirm, evidenceSnapshots, linkedFindings } from './evidence';

export function uid(prefix = 'id'): string { return `${prefix}_${globalThis.crypto.randomUUID()}`; }
export function initialState(sessionId = uid('session'), caseId = uid('case')): SessionState {
  return { sessionId, caseId, started: false, mode: 'listen', lifecycle: 'active', activity: 'idle', supportState: 'normal', epoch: 0, activeRunId: null, contextRevision: 0, messages: [], sources: [], findings: [], cards: [], currentCardId: null, selectedQuestion: '', practiceCriteria: [], endSnapshot: null };
}
export function isCurrent(state: SessionState, token: RunToken): boolean {
  return state.lifecycle === 'active' && state.sessionId === token.sessionId && state.activeRunId === token.runId && state.epoch === token.epoch && state.contextRevision === token.contextRevision;
}
export function currentCard(state: SessionState): Card | null { return state.lifecycle === 'ended' ? state.endSnapshot?.card ?? null : state.cards.find(c => c.id === state.currentCardId) ?? null; }
function invalidate(state: SessionState, sourceId: string): SessionState {
  const findings = state.findings.map(f => f.evidenceRefs.some(r => r.sourceId === sourceId) ? { ...f, validity: 'stale' as const } : f);
  const invalid = new Set(findings.filter(f => f.validity === 'stale').map(f => f.id));
  const cards = state.cards.map(c => c.sections.some(s => s.findingIds.some(id => invalid.has(id))) ? { ...c, validity: 'stale' as const } : c);
  return { ...state, findings, cards, epoch: state.epoch + 1, contextRevision: state.contextRevision + 1, activeRunId: null, activity: 'idle' };
}
export function makeEndSnapshot(state: SessionState, includeDraft = false): EndSnapshot | null {
  const card = currentCard(state);
  if (!card || (!includeDraft && card.validity !== 'confirmed') || !cardCanConfirm(card, state.findings, state.sources)) return null;
  return structuredClone({ id: uid('snapshot'), sessionId: state.sessionId, card, findings: linkedFindings(card, state.findings), evidence: evidenceSnapshots(card, state.findings, state.sources), confirmedPractice: [], createdAt: new Date().toISOString() });
}
export type Event =
  | { type: 'START'; mode: Mode; welcome?: string }
  | { type: 'MODE'; mode: Mode }
  | { type: 'USER'; text: string; source: Source }
  | { type: 'RUN'; runId: string; activity: Activity }
  | { type: 'ACTIVITY'; token: RunToken; activity: Activity }
  | { type: 'CANDIDATE'; candidate: TurnCandidate }
  | { type: 'FINISH'; token: RunToken; activity?: Activity }
  | { type: 'STOP' } | { type: 'END' }
  | { type: 'ADD_SOURCE'; source: Source }
  | { type: 'CORRECT_SOURCE'; id: string; text: string }
  | { type: 'CONFIRM_SOURCE'; id: string }
  | { type: 'REJECT'; id: string }
  | { type: 'EDIT_CARD'; title: string; sections: Card['sections'] }
  | { type: 'CONFIRM_CARD' }
  | { type: 'CONFIRM_END_CARD' }
  | { type: 'PREPARE_PRACTICE' }
  | { type: 'PRACTICE'; question: string; criteria: string[] }
  | { type: 'DELETE_CASE'; caseId: string }
  | { type: 'REPLACE'; state: SessionState };
export function reducer(state: SessionState, event: Event): SessionState {
  if (event.type === 'REPLACE') return event.state;
  if (event.type === 'DELETE_CASE') {
    if (state.caseId !== event.caseId) return state;
    return { ...initialState(), lifecycle: state.lifecycle, started: state.started, epoch: state.epoch + 1 };
  }
  if (event.type === 'CONFIRM_END_CARD' && state.lifecycle === 'ended' && state.endSnapshot?.card.validity === 'draft') {
    // The snapshot was validated before raw sources were cleared. Only an explicit
    // save action can accept this read-only draft; no Agent run can reach this event.
    return { ...state, endSnapshot: { ...state.endSnapshot, card: { ...state.endSnapshot.card, validity: 'confirmed' }, findings: state.endSnapshot.findings.map(f => ({ ...f, validity: 'confirmed' })) } };
  }
  if (state.lifecycle === 'ended') return state;
  switch (event.type) {
    case 'START': return { ...state, started: true, mode: event.mode, activity: 'idle', messages: event.welcome ? [{ id: uid('message'), role: 'assistant', text: event.welcome }] : state.messages };
    case 'MODE': return { ...state, mode: event.mode, epoch: state.epoch + 1, activeRunId: null, activity: 'idle' };
    case 'USER': return { ...state, messages: [...state.messages, { id: uid('message'), role: 'user', text: event.text, sourceId: event.source.id }], sources: [...state.sources, event.source], contextRevision: state.contextRevision + 1 };
    case 'RUN': return { ...state, activeRunId: event.runId, activity: event.activity };
    case 'ACTIVITY': return isCurrent(state, event.token) ? { ...state, activity: event.activity } : state;
    case 'FINISH': return isCurrent(state, event.token) ? { ...state, activeRunId: null, activity: event.activity ?? 'idle' } : state;
    case 'CANDIDATE': {
      if (!isCurrent(state, event.candidate)) return state;
      const c = event.candidate;
      const nextRevision = Math.max(0, ...state.cards.map(v => v.revision)) + 1;
      const card = c.cardDraft ? { ...c.cardDraft, caseId: state.caseId, revision: nextRevision, parentRevision: currentCard(state)?.revision ?? null } : undefined;
      return { ...state, rejectedFindings: state.mode !== 'listen' && !c.supportGuidance ? state.rejectedFindings?.map(f => ({...f, needsAcknowledgement: false})) : state.rejectedFindings, ...(c.practiceSetup ? { selectedQuestion: c.practiceSetup.question, practiceCriteria: c.practiceSetup.criteria, contextRevision: state.contextRevision + 1 } : {}), mode: c.supportGuidance ? 'listen' : state.mode, activeRunId: null, activity: 'idle', supportState: c.supportGuidance ? 'support_guidance' : state.supportState, messages: [...state.messages, { id: uid('message'), role: 'assistant', text: c.assistantText, serviceMode: c.serviceMode }], findings: [...state.findings, ...c.findings], cards: card ? [...state.cards, card] : state.cards, currentCardId: card?.id ?? state.currentCardId };
    }
    case 'STOP': return { ...state, epoch: state.epoch + 1, activeRunId: null, activity: 'paused' };
    case 'END': return { ...state, lifecycle: 'ended', epoch: state.epoch + 1, activeRunId: null, activity: 'idle', endSnapshot: makeEndSnapshot(state, true), rejectedFindings: [], messages: [], sources: [], findings: [], cards: [], currentCardId: null, selectedQuestion: '', practiceCriteria: [] };
    case 'ADD_SOURCE': return { ...state, sources: [...state.sources, event.source], contextRevision: state.contextRevision + 1, epoch: state.epoch + 1, activeRunId: null, activity: 'idle' };
    case 'CORRECT_SOURCE': {
      if (!state.sources.some(s => s.id === event.id)) return state;
      const s = invalidate(state, event.id);
      return { ...s, sources: s.sources.map(v => v.id === event.id ? { ...v, text: event.text, revision: v.revision + 1, confirmed: true } : v), messages: s.messages.map(m => m.sourceId === event.id ? { ...m, text: event.text } : m) };
    }
    case 'CONFIRM_SOURCE': return { ...state, sources: state.sources.map(s => s.id === event.id ? { ...s, confirmed: true } : s), epoch: state.epoch + 1, contextRevision: state.contextRevision + 1, activeRunId: null, activity: 'idle' };
    case 'REJECT': {
      const rejected = state.findings.find(f => f.id === event.id);
      if (!rejected) return state;
      const rejectedFindings = [...(state.rejectedFindings ?? []).filter(f => f.text !== rejected.text), { needsAcknowledgement: true, text: rejected.text, mode: state.mode, sources: rejected.evidenceRefs.map(({ sourceId, sourceRevision }) => ({ sourceId, sourceRevision })) }].slice(-4);
      const findings = state.findings.map(f => f.id === event.id ? { ...f, validity: 'disputed' as const } : f);
      return { ...state, rejectedFindings, findings, cards: state.cards.map(c => c.sections.some(s => s.findingIds.includes(event.id)) ? { ...c, validity: 'disputed' as const } : c), epoch: state.epoch + 1, contextRevision: state.contextRevision + 1, activeRunId: null, activity: 'idle' };
    }
    case 'EDIT_CARD': {
      const card = currentCard(state);
      if (!card || ['stale', 'disputed'].includes(card.validity)) return state;
      // Only text edits; evidence links remain immutable through this action.
      const sections = event.sections.flatMap(s => {
        const original = card.sections.find(v => v.key === s.key && JSON.stringify(v.findingIds) === JSON.stringify(s.findingIds));
        return original ? [{ ...original, text: s.text, userEdited: original.userEdited || s.text !== original.text, findingIds: s.text.trim() ? original.findingIds : [] }] : [];
      });
      const updated = { ...card, revision: card.revision + 1, parentRevision: card.revision, title: event.title, titleUserEdited: card.titleUserEdited || event.title !== card.title, sections, validity: 'draft' as const };
      return { ...state, cards: state.cards.map(c => c.id === card.id ? updated : c) };
    }
    case 'CONFIRM_CARD': {
      const card = currentCard(state);
      if (!card || !cardCanConfirm(card, state.findings, state.sources)) return state;
      const ids = new Set(card.sections.flatMap(s => s.findingIds));
      return { ...state, cards: state.cards.map(c => c.id === card.id ? { ...c, validity: 'confirmed' } : c), findings: state.findings.map(f => ids.has(f.id) ? { ...f, validity: 'confirmed' } : f) };
    }
    case 'PREPARE_PRACTICE': return { ...state, mode: 'practice', selectedQuestion: '', practiceCriteria: [], contextRevision: state.contextRevision + 1, epoch: state.epoch + 1, activeRunId: null, activity: 'idle' };
    case 'PRACTICE': return { ...state, mode: 'practice', selectedQuestion: event.question, practiceCriteria: event.criteria.slice(0, 2), epoch: state.epoch + 1, activeRunId: null, activity: 'idle' };
    default: return state;
  }
}
