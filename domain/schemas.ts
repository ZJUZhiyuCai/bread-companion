import { z } from 'zod';

// Reject partial gateway responses before they can break the interactive shell.
export const capabilitiesSchema = z.object({
  agent: z.object({ mode: z.enum(['mock', 'real']), label: z.string(), configured: z.boolean() }),
  asr: z.object({ available: z.boolean(), label: z.string(), reason: z.string().optional() }),
  tts: z.object({ available: z.boolean(), label: z.string(), reason: z.string().optional(), greeting: z.string().optional(), turnStream: z.boolean().optional() }),
  limits: z.object({ maxInputChars: z.number().positive(), maxSourceChars: z.number().positive(), maxAudioBytes: z.number().positive(), maxRecordingSeconds: z.number().positive() }),
  processingNotice: z.string(),
});

// All length limits count JavaScript UTF-16 code units. Evidence uses stable segments, not offsets.
export const idSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9:_-]+$/);
export const modeSchema = z.enum(['listen', 'organize', 'review', 'practice']);
export const originSchema = z.enum(['source_quote', 'user_recollection', 'explicit_feedback']);
export const validitySchema = z.enum(['draft', 'confirmed', 'stale', 'disputed']);
export const sourceSchema = z.strictObject({ id: idSchema, revision: z.int().min(1), origin: originSchema, label: z.string().max(100), text: z.string().min(1).max(20000), confirmed: z.boolean() });
export const sourceSegmentSchema = z.strictObject({ sourceId: idSchema, sourceRevision: z.int().min(1), segmentId: idSchema, origin: originSchema, label: z.string().max(100), text: z.string().min(1).max(1000).refine(s => Array.from(s).length <= 500), confirmed: z.boolean() }).refine(s => s.segmentId.startsWith(`${s.sourceId}:r${s.sourceRevision}:s`) && /^\d+$/.test(s.segmentId.slice(`${s.sourceId}:r${s.sourceRevision}:s`.length)));
export const evidenceSchema = z.strictObject({ sourceId: idSchema, sourceRevision: z.int().min(1), segmentId: idSchema, quote: z.string().min(1).max(1000) });
export const findingSchema = z.strictObject({ id: idSchema, kind: z.enum(['reported_fact', 'inference', 'unknown', 'practice_suggestion']), text: z.string().min(1).max(1500), evidenceRefs: z.array(evidenceSchema).max(6), validity: validitySchema });
export const sectionSchema = z.strictObject({ key: z.string().min(1).max(80), text: z.string().max(3000), findingIds: z.array(idSchema).max(12), userEdited: z.boolean().optional() });
export const cardSchema = z.strictObject({ id: idSchema, caseId: idSchema, revision: z.int().min(1), parentRevision: z.int().min(1).nullable(), titleUserEdited: z.boolean().optional(), type: z.enum(['note', 'review']), title: z.string().min(1).max(100), sections: z.array(sectionSchema).max(10), validity: validitySchema, createdAt: z.iso.datetime(), serviceMode: z.enum(['mock', 'real']) });
export const practiceSetupSchema = z.strictObject({ question: z.string().trim().min(1).max(1000), criteria: z.array(z.string().trim().min(1).max(100)).min(1).max(2) });
const runShape = { sessionId: idSchema, runId: idSchema, epoch: z.int().min(0), contextRevision: z.int().min(0) };
export const turnRequestSchema = z.strictObject({ ...runShape, requestId: idSchema, mode: modeSchema, channel: z.enum(['text', 'call']).optional(), userMessage: z.string().trim().min(1).max(4000), context: z.strictObject({ rejectedFindings: z.array(z.strictObject({ needsAcknowledgement: z.boolean().optional(), text: z.string().min(1).max(1500), mode: modeSchema, sources: z.array(z.strictObject({ sourceId: idSchema, sourceRevision: z.int().min(1) })).max(6) })).max(4).optional(), summary: z.string().max(1200), recentMessages: z.array(z.strictObject({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) })).max(16), sources: z.array(sourceSchema).max(24), sourceSegments: z.array(sourceSegmentSchema).max(6).optional(), preferences: z.strictObject({ advice: z.enum(['on_request', 'welcome']).optional(), questions: z.enum(['avoid', 'allowed']).optional() }).optional(), selectedQuestion: z.string().max(1000).optional(), practiceCriteria: z.array(z.string().min(1).max(100)).max(2).optional() }) }).superRefine((v, ctx) => {
  if (new Set(v.context.sources.map(s => s.id)).size !== v.context.sources.length) ctx.addIssue({ code: 'custom', message: 'Duplicate source identifiers' });
  if (v.context.sourceSegments && (v.context.sources.length || new Set(v.context.sourceSegments.map(s => s.segmentId)).size !== v.context.sourceSegments.length)) ctx.addIssue({ code: 'custom', message: 'Ambiguous or duplicate evidence segments' });
  if (v.mode === 'practice' && Boolean(v.context.selectedQuestion?.trim()) !== Boolean(v.context.practiceCriteria?.length)) ctx.addIssue({ code: 'custom', message: 'Practice context must contain both question and criteria, or neither for agent preparation' });
});
export const candidateSchema = z.strictObject({ ...runShape, requestId: idSchema, assistantText: z.string().min(1).max(2000), findings: z.array(findingSchema).max(12), cardDraft: cardSchema.optional(), practiceSetup: practiceSetupSchema.optional(), suggestedMode: modeSchema.optional(), supportGuidance: z.boolean().optional(), warnings: z.array(z.string().max(300)).max(8), serviceMode: z.enum(['mock', 'real']) });
// The model never supplies controller identifiers, consent, validity, persistence actions or timestamps.
export const modelContentSchema = z.strictObject({ assistantText: z.string().min(1).max(2000), findings: z.array(findingSchema.omit({ validity: true }).extend({ evidenceRefs: z.array(evidenceSchema).max(6).default([]) })).max(12), card: z.object({ type: z.enum(['note', 'review']), title: z.string().min(1).max(100), sections: z.array(sectionSchema.omit({ userEdited: true })).min(1).max(10) }).strip().optional(), practiceSetup: practiceSetupSchema.optional(), supportGuidance: z.boolean().optional(), warnings: z.array(z.string().max(300)).max(8).default([]) });
export const savedCaseSchema = z.strictObject({ schemaVersion: z.literal(1), caseId: idSchema, savedAt: z.iso.datetime(), cards: z.array(cardSchema).min(1).max(80), findings: z.array(findingSchema).max(200), selectedEvidence: z.array(evidenceSchema.extend({ origin: originSchema, confirmed: z.boolean() })).max(250), confirmedPractice: z.array(z.strictObject({ id: idSchema, question: z.string().max(1000), answerOutline: z.string().max(5000) })).max(20) });
export const speechRequestSchema = z.strictObject({ ...runShape, requestId: idSchema, text: z.string().trim().min(1).max(2000) });
