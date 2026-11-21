import type { SessionState, Source, SourceSegment, TurnRequest } from './types';
import { segments } from './evidence';
import { interviewNeedsDebrief } from './policy';
import { conversationPreferences } from './preferences';

export const CONTEXT_LIMITS = { historyBytes: 8000, wireBytes: 36000, rejectionBytes: 10000, segments: 6 } as const;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export function materialSources(state: SessionState): Source[] {
  const utterances = new Set(state.messages.map(m => m.sourceId).filter(Boolean));
  return state.sources.filter(s => !utterances.has(s.id) && s.label !== '本次请求');
}
export function requestSegments(input: TurnRequest): SourceSegment[] {
  const { sourceSegments, sources, interview } = input.context;
  if (sourceSegments) return sourceSegments;
  const evidence = input.mode === 'interview' && interviewNeedsDebrief(interview)
    ? sources.filter(s => s.confirmed && interview?.answerSourceIds?.includes(s.id)) : sources;
  return selectSegments(evidence, input.userMessage);
}

export function buildTurn(state: SessionState, userMessage: string, runId: string, requestId: string): TurnRequest {
  const rejectedFindings = (state.rejectedFindings ?? []).slice(-4);
  while (bytes(rejectedFindings) > CONTEXT_LIMITS.rejectionBytes && rejectedFindings.length > 1) rejectedFindings.shift();
  const omitAnalysis = rejectedFindings.length > 0 || state.findings.some(f => f.validity === 'stale');
  const interview = state.mode === 'interview' && state.interview ? {
    ...state.interview, focusPoints: state.interview.focusPoints.slice(0, 2), notes: state.interview.notes.slice(-6),
    answerSourceIds: (state.interview.answerSourceIds ?? []).slice(-12),
  } : undefined;
  const debrief = interview && interviewNeedsDebrief(interview);
  const materials = debrief ? [] : materialSources(state);
  const recentIds = new Set(debrief ? interview.answerSourceIds : state.messages.filter(m => m.role === 'user').slice(-12).map(m => m.sourceId));
  const recentSources = state.sources.filter(s => recentIds.has(s.id) && s.label !== '本次请求' && (!debrief || s.confirmed));
  const card = state.cards.find(c => c.id === state.currentCardId);
  const findingIds = new Set(card?.sections.flatMap(s => s.findingIds));
  const linkedIds = new Set(state.findings.filter(f => findingIds.has(f.id) && !['stale', 'disputed'].includes(f.validity)).flatMap(f => f.evidenceRefs.map(r => r.sourceId)));
  const linked = state.sources.filter(s => linkedIds.has(s.id));
  const query = `${userMessage} ${interview ? `${interview.currentQuestion} ${interview.role} ${interview.topic}` : state.selectedQuestion}`;
  // Reserve material coverage independently of chat length; preserve exact segment ids/quotes.
  const currentAnswer = (state.mode === 'practice' && state.selectedQuestion) || interview?.currentQuestion ? recentSources.slice(-1) : [];
  const reserved = selectSegments(currentAnswer, userMessage).slice(0, 1);
  const materialSegments = selectSegments(materials, query);
  const recentSegments = debrief ? recentSources.slice(-6).reverse().flatMap(source => selectSegments([source], query).slice(0, 1))
    : selectSegments(recentSources, query).slice(0, 3);
  const ranked = [
    ...reserved,
    ...materialSegments.slice(0, 2),
    ...recentSegments,
    ...(interview ? [] : selectSegments(linked, query)),
    ...materialSegments,
  ];
  const sourceSegments = [...new Map(ranked.map(s => [s.segmentId, s])).values()].slice(0, CONTEXT_LIMITS.segments);
  const recentMessages: TurnRequest['context']['recentMessages'] = [];
  let size = 0;
  for (const m of state.messages.slice(-16).reverse()) {
    if (!recentMessages.length && m.role === 'user' && m.text === userMessage) continue;
    if (omitAnalysis && m.role === 'assistant') continue;
    const entry = { role: m.role, text: m.text };
    if (size + bytes(entry) > CONTEXT_LIMITS.historyBytes) break;
    recentMessages.unshift(entry); size += bytes(entry);
  }
  const turn: TurnRequest = { sessionId: state.sessionId, runId, epoch: state.epoch, contextRevision: state.contextRevision, requestId, mode: state.mode, userMessage, context: { rejectedFindings, summary: '', recentMessages, sources: [], sourceSegments, preferences: conversationPreferences(state.messages), ...(interview ? { interview } : {}), ...(state.mode !== 'interview' && state.selectedQuestion ? { selectedQuestion: state.selectedQuestion, practiceCriteria: state.practiceCriteria } : {}) } };
  const overBudget = () => bytes(turn) > CONTEXT_LIMITS.wireBytes - (interview ? 20 : 0); // Leave room for the channel field.
  while (overBudget() && recentMessages.length) recentMessages.shift();
  if (interview) {
    while (overBudget() && sourceSegments.length > reserved.length) sourceSegments.pop();
    while (overBudget() && interview.notes.length) interview.notes.shift();
    if (overBudget()) interview.focusPoints = [];
    if (overBudget()) { interview.role = ''; interview.topic = ''; }
  }
  while (overBudget() && sourceSegments.length) sourceSegments.pop();
  if (interview && overBudget()) interview.currentQuestion = Array.from(interview.currentQuestion).slice(0, 100).join('');
  return turn;
}
export function selectSegments(sources: Source[], query: string): SourceSegment[] {
  const distinct = Array.from(new Set(query.match(/[\p{Script=Han}]|[a-zA-Z]{3,}/gu) ?? []));
  const terms = distinct.length > 64 ? [...distinct.slice(0, 32), ...distinct.slice(-32)] : distinct;
  return sources.filter(s => s.label !== '本次请求').flatMap((s, order) => segments(s).map(seg => ({ sourceId: s.id, sourceRevision: s.revision, origin: s.origin, confirmed: s.confirmed, label: s.label, segmentId: seg.id, text: seg.text, score: terms.reduce((n, t) => n + (seg.text.includes(t) ? 1 : 0), 0) + order * 0.01 }))).sort((a, b) => b.score - a.score).slice(0, 6).map(({ score: _, ...segment }) => segment);
}
