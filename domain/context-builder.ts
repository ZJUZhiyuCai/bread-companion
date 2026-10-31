import type { SessionState, Source, TurnRequest } from './types';
import { segments } from './evidence';

export function buildTurn(state: SessionState, userMessage: string, runId: string, requestId: string): TurnRequest {
  // Action buttons remain in conversation history, but must not push actual
  // interview material out of the evidence window after several iterations.
  const sources = state.sources.filter(s => s.label !== '本次请求').slice(-24);
  return { sessionId: state.sessionId, runId, epoch: state.epoch, contextRevision: state.contextRevision, requestId, mode: state.mode, userMessage, context: { summary: '', recentMessages: state.messages.slice(-16).map(({ role, text }) => ({ role, text })), sources, ...(state.selectedQuestion ? { selectedQuestion: state.selectedQuestion, practiceCriteria: state.practiceCriteria } : {}) } };
}
export function selectSegments(sources: Source[], query: string) {
  const terms = Array.from(new Set(query.match(/[\p{Script=Han}]|[a-zA-Z]{3,}/gu) ?? []));
  return sources.filter(s => s.label !== '本次请求').flatMap((s, order) => segments(s).map(seg => ({ sourceId: s.id, sourceRevision: s.revision, origin: s.origin, confirmed: s.confirmed, label: s.label, segmentId: seg.id, text: seg.text, score: terms.reduce((n, t) => n + (seg.text.includes(t) ? 1 : 0), 0) + order * 0.01 }))).sort((a, b) => b.score - a.score).slice(0, 6).map(({ score: _, ...segment }) => segment);
}
