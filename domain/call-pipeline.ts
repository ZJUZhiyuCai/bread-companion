import { z } from 'zod';
import type { SessionState, Source, TurnRequest } from './types';
import { idSchema, sourceSchema, turnRequestSchema } from './schemas';
import { buildTurn, materialSources } from './context-builder';
import { conversationPreferences } from './preferences';
import { explicitIntent, isActionOnly } from './policy';
import { initialState, uid } from './reducer';

// A bounded snapshot for ordinary listening only. Evidence/card workflows keep
// their existing client-controlled path, including explicit requests made by voice.
export const callSeedSchema = z.strictObject({
  sessionId: idSchema, runId: idSchema, requestId: idSchema, sourceId: idSchema,
  epoch: z.int().min(0), contextRevision: z.int().min(0),
  messages: z.array(z.strictObject({ id: idSchema, role: z.enum(['user', 'assistant']), text: z.string().max(4000), sourceId: idSchema.optional() })).max(28),
  sources: z.array(sourceSchema).max(12),
  preferences: z.strictObject({ advice: z.enum(['on_request', 'welcome']).optional(), questions: z.enum(['avoid', 'allowed']).optional() }),
}).refine(v => new Set(v.sources.map(s => s.id)).size === v.sources.length
  && new Set(v.messages.map(m => m.id)).size === v.messages.length
  && !v.sources.some(s => s.id === v.sourceId)
  && v.sources.every(s => v.messages.some(m => m.role === 'user' && m.sourceId === s.id && m.text === s.text)));
export type CallSeed = z.infer<typeof callSeedSchema>;
export const CALL_SEED_BYTES = 64000;
export const isCallHangup = (text: string) => /^(?:好[的吧]?[，,\s]*)?(?:先)?(?:挂了|挂断(?:电话)?|挂电话|不聊了|再见|晚安)[。！!，,\s]*$/.test(text);
export function callSource(text: string, id = uid('source')): Source {
  return { id, revision: 1, origin: 'user_recollection', label: isActionOnly(text) ? '本次请求' : '我说的话', text, confirmed: true };
}
export function createCallSeed(state: SessionState): CallSeed | null {
  if (state.mode !== 'listen' || state.lifecycle !== 'active' || !state.started || state.cards.length || state.findings.length
    || state.rejectedFindings?.length || state.selectedQuestion || materialSources(state).length) return null;
  const recentUsers = state.messages.filter(m => m.role === 'user').slice(-12);
  const ids = new Set([...recentUsers, ...state.messages.slice(-16)].map(m => m.id));
  const sourceIds = new Set(recentUsers.map(m => m.sourceId));
  const seed = { sessionId: state.sessionId, epoch: state.epoch, contextRevision: state.contextRevision,
    runId: uid('run'), requestId: uid('request'), sourceId: uid('source'),
    messages: state.messages.filter(m => ids.has(m.id)).map(({ id, role, text, sourceId }) => ({ id, role, text, ...(sourceId ? { sourceId } : {}) })),
    sources: state.sources.filter(s => sourceIds.has(s.id)), preferences: conversationPreferences(state.messages) };
  if (new TextEncoder().encode(JSON.stringify(seed)).length > CALL_SEED_BYTES) return null;
  const result = callSeedSchema.safeParse(seed); return result.success ? result.data : null;
}
/** Reconstruct exactly the normal listening request, without granting the server
 * authority to change mode, confirm material, save, or choose a user's next step. */
export function completeCallSeed(seed: CallSeed, rawText: string): TurnRequest | null {
  const text = rawText.trim();
  if (!text || explicitIntent(text) || isCallHangup(text)) return null;
  const state: SessionState = { ...initialState(), sessionId: seed.sessionId, started: true, epoch: seed.epoch,
    contextRevision: seed.contextRevision + 1,
    messages: [...seed.messages, { id: 'pending_transcript', role: 'user', text, sourceId: seed.sourceId }],
    sources: [...seed.sources, callSource(text, seed.sourceId)] };
  const request = { ...buildTurn(state, text, seed.runId, seed.requestId), channel: 'call' as const };
  // Explicit preferences may predate the bounded history. The current statement
  // can override them; a quoted statement cannot.
  request.context.preferences = { ...seed.preferences, ...conversationPreferences([{ role: 'user', text }]) };
  return turnRequestSchema.parse(request);
}
