import { z } from 'zod';
import type { SessionState, Source, TurnRequest } from './types';
import { idSchema, interviewStateSchema, sourceSchema, turnRequestSchema } from './schemas';
import { buildTurn, materialSources } from './context-builder';
import { conversationPreferences } from './preferences';
import { explicitIntent, interviewControlIntent, interviewNeedsDebrief, isActionOnly } from './policy';
import { initialState, reducer, uid } from './reducer';

// A bounded snapshot for listening and interview answers. Voice commands return
// to the controller, which owns mode, style and debrief transitions.
export const callSeedSchema = z.strictObject({
  sessionId: idSchema, runId: idSchema, requestId: idSchema, sourceId: idSchema,
  epoch: z.int().min(0), contextRevision: z.int().min(0),
  mode: z.enum(['listen', 'interview']).optional(), interview: interviewStateSchema.optional(),
  messages: z.array(z.strictObject({ id: idSchema, role: z.enum(['user', 'assistant']), text: z.string().max(4000), sourceId: idSchema.optional() })).max(28),
  sources: z.array(sourceSchema).max(16),
  preferences: z.strictObject({ advice: z.enum(['on_request', 'welcome']).optional(), questions: z.enum(['avoid', 'allowed']).optional() }),
}).refine(v => {
  const interview = v.mode === 'interview';
  if (interview !== !!v.interview || v.interview?.stage === 'debrief') return false;
  if (new Set(v.sources.map(s => s.id)).size !== v.sources.length || new Set(v.messages.map(m => m.id)).size !== v.messages.length) return false;
  let materialCount = 0;
  for (const source of v.sources) {
    if (source.id === v.sourceId || source.revision !== 1) return false;
    const message = v.messages.find(m => m.sourceId === source.id);
    if (!message) materialCount++;
    else if (message.role !== 'user' || message.text !== source.text) return false;
  }
  return v.sources.length - materialCount <= 12 && materialCount <= (interview ? 4 : 0);
});
export type CallSeed = z.infer<typeof callSeedSchema>;
export const CALL_SEED_BYTES = 64000;
export const isCallHangup = (text: string) => /^(?:好[的吧]?[，,\s]*)?(?:先)?(?:挂了|挂断(?:电话)?|挂电话|不聊了|再见|晚安)[。！!，,\s]*$/.test(text);
export function callSource(text: string, id = uid('source')): Source {
  return { id, revision: 1, origin: 'user_recollection', label: isActionOnly(text) ? '本次请求' : '我说的话', text, confirmed: true };
}
export function createCallSeed(state: SessionState): CallSeed | null {
  if (state.lifecycle !== 'active' || !state.started || state.rejectedFindings?.length || state.sources.some(s => s.revision !== 1)) return null;
  const interview = state.mode === 'interview' ? state.interview : null;
  if (state.mode !== 'listen' && (!interview || interview.stage === 'debrief' || state.findings.some(f => f.validity === 'stale'))) return null;
  const materials = materialSources(state);
  if (!interview && (state.cards.length || state.findings.length || state.selectedQuestion || materials.length)) return null;
  if (materials.length > 4) return null;
  const users = state.messages.filter(m => m.role === 'user');
  const recentUsers = interviewNeedsDebrief(interview)
    ? users.filter(m => m.sourceId && interview?.answerSourceIds?.includes(m.sourceId))
    : users.slice(-12);
  const ids = new Set([...recentUsers, ...state.messages.slice(-16)].map(m => m.id));
  const sourceIds = new Set(recentUsers.map(m => m.sourceId));
  const seed = { sessionId: state.sessionId, epoch: state.epoch, contextRevision: state.contextRevision,
    runId: uid('run'), requestId: uid('request'), sourceId: uid('source'),
    messages: state.messages.filter(m => ids.has(m.id)).map(({ id, role, text, sourceId }) => ({ id, role, text, ...(sourceId ? { sourceId } : {}) })),
    sources: [...state.sources.filter(s => sourceIds.has(s.id)), ...materials], preferences: conversationPreferences(state.messages),
    ...(interview ? { mode: 'interview' as const, interview } : {}) };
  if (new TextEncoder().encode(JSON.stringify(seed)).length > CALL_SEED_BYTES) return null;
  const result = callSeedSchema.safeParse(seed); return result.success ? result.data : null;
}
/** Reconstruct the normal turn request from the transcript and the controller's snapshot. */
export function completeCallSeed(seed: CallSeed, rawText: string): TurnRequest | null {
  const text = rawText.trim();
  if (!text || explicitIntent(text) || interviewControlIntent(text) || isCallHangup(text)) return null;
  const state: SessionState = { ...initialState(), sessionId: seed.sessionId, started: true, epoch: seed.epoch,
    mode: seed.mode ?? 'listen', interview: seed.interview ?? null,
    contextRevision: seed.contextRevision, messages: seed.messages, sources: seed.sources };
  const answered = reducer(state, { type: 'USER', text, source: callSource(text, seed.sourceId) });
  const request = { ...buildTurn(answered, text, seed.runId, seed.requestId), channel: 'call' as const };
  // Explicit preferences may predate the bounded history. The current statement
  // can override them; a quoted statement cannot.
  request.context.preferences = { ...seed.preferences, ...conversationPreferences([{ role: 'user', text }]) };
  return turnRequestSchema.parse(request);
}
