export type Mode = 'listen' | 'organize' | 'review' | 'practice';
export type Activity = 'idle' | 'requesting_mic' | 'recording' | 'recorded' | 'transcribing' | 'generating' | 'validating' | 'speaking' | 'paused' | 'error';
export type Origin = 'source_quote' | 'user_recollection' | 'explicit_feedback';
export type Validity = 'draft' | 'confirmed' | 'stale' | 'disputed';
export interface Source { id: string; revision: number; origin: Origin; label: string; text: string; confirmed: boolean; }
export interface EvidenceRef { sourceId: string; sourceRevision: number; segmentId: string; quote: string; }
export interface EvidenceSnapshot extends EvidenceRef { origin: Origin; confirmed: boolean; }
export interface Finding { id: string; kind: 'reported_fact' | 'inference' | 'unknown' | 'practice_suggestion'; text: string; evidenceRefs: EvidenceRef[]; validity: Validity; }
export interface Card { id: string; caseId: string; revision: number; parentRevision: number | null; type: 'note' | 'review'; title: string; sections: { key: string; text: string; findingIds: string[] }[]; validity: Validity; createdAt: string; serviceMode: 'mock' | 'real'; }
export interface SavedCase { schemaVersion: 1; caseId: string; savedAt: string; cards: Card[]; findings: Finding[]; selectedEvidence: EvidenceSnapshot[]; confirmedPractice: { id: string; question: string; answerOutline: string }[]; }
export interface EndSnapshot { id: string; sessionId: string; card: Card; findings: Finding[]; evidence: EvidenceSnapshot[]; confirmedPractice: SavedCase['confirmedPractice']; createdAt: string; }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; sourceId?: string; serviceMode?: 'mock' | 'real'; }
export interface RunToken { sessionId: string; runId: string; epoch: number; contextRevision: number; }
export interface SessionState { sessionId: string; caseId: string; started: boolean; mode: Mode; lifecycle: 'active' | 'ended'; activity: Activity; supportState: 'normal' | 'support_guidance'; epoch: number; activeRunId: string | null; contextRevision: number; messages: Message[]; sources: Source[]; findings: Finding[]; cards: Card[]; currentCardId: string | null; selectedQuestion: string; practiceCriteria: string[]; endSnapshot: EndSnapshot | null; }
export interface TurnRequest extends RunToken { requestId: string; mode: Mode; userMessage: string; context: { summary: string; recentMessages: { role: 'user' | 'assistant'; text: string }[]; sources: Source[]; selectedQuestion?: string; practiceCriteria?: string[] }; }
export interface PracticeSetup { question: string; criteria: string[]; }
export interface TurnCandidate extends RunToken { requestId: string; assistantText: string; findings: Finding[]; cardDraft?: Card; practiceSetup?: PracticeSetup; suggestedMode?: Mode; supportGuidance?: boolean; warnings: string[]; serviceMode: 'mock' | 'real'; }
export interface Capabilities { agent: { mode: 'mock' | 'real'; label: string; configured: boolean }; asr: { available: boolean; label: string; reason?: string }; tts: { available: boolean; label: string; reason?: string }; limits: { maxInputChars: number; maxSourceChars: number; maxAudioBytes: number; maxRecordingSeconds: number }; processingNotice: string; }
