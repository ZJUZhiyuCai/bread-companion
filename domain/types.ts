export type Mode = 'listen' | 'organize' | 'review' | 'practice';
export type Activity = 'idle' | 'requesting_mic' | 'recording' | 'recorded' | 'transcribing' | 'generating' | 'validating' | 'preparing_speech' | 'speaking' | 'paused' | 'error';
export type Origin = 'source_quote' | 'user_recollection' | 'explicit_feedback';
export type Validity = 'draft' | 'confirmed' | 'stale' | 'disputed';
export interface Source { id: string; revision: number; origin: Origin; label: string; text: string; confirmed: boolean; }
export interface SourceSegment { sourceId: string; sourceRevision: number; segmentId: string; origin: Origin; label: string; text: string; confirmed: boolean; }
export interface ConversationPreferences { advice?: 'on_request' | 'welcome'; questions?: 'avoid' | 'allowed'; }
export interface EvidenceRef { sourceId: string; sourceRevision: number; segmentId: string; quote: string; }
export interface EvidenceSnapshot extends EvidenceRef { origin: Origin; confirmed: boolean; }
export interface Finding { id: string; kind: 'reported_fact' | 'inference' | 'unknown' | 'practice_suggestion'; text: string; evidenceRefs: EvidenceRef[]; validity: Validity; }
export interface RejectedFinding { needsAcknowledgement?: boolean; text: string; mode: Mode; sources: { sourceId: string; sourceRevision: number }[]; }
export interface Card { id: string; caseId: string; revision: number; parentRevision: number | null; titleUserEdited?: boolean; type: 'note' | 'review'; title: string; sections: { key: string; text: string; findingIds: string[]; userEdited?: boolean }[]; validity: Validity; createdAt: string; serviceMode: 'mock' | 'real'; }
export interface SavedCase { schemaVersion: 1; caseId: string; savedAt: string; cards: Card[]; findings: Finding[]; selectedEvidence: EvidenceSnapshot[]; confirmedPractice: { id: string; question: string; answerOutline: string }[]; }
export interface EndSnapshot { id: string; sessionId: string; card: Card; findings: Finding[]; evidence: EvidenceSnapshot[]; confirmedPractice: SavedCase['confirmedPractice']; createdAt: string; }
export interface Message { id: string; role: 'user' | 'assistant'; text: string; sourceId?: string; serviceMode?: 'mock' | 'real'; }
export interface RunToken { sessionId: string; runId: string; epoch: number; contextRevision: number; }
export interface SessionState { rejectedFindings?: RejectedFinding[]; sessionId: string; caseId: string; started: boolean; mode: Mode; lifecycle: 'active' | 'ended'; activity: Activity; supportState: 'normal' | 'support_guidance'; epoch: number; activeRunId: string | null; contextRevision: number; messages: Message[]; sources: Source[]; findings: Finding[]; cards: Card[]; currentCardId: string | null; selectedQuestion: string; practiceCriteria: string[]; endSnapshot: EndSnapshot | null; }
export interface TurnRequest extends RunToken { requestId: string; mode: Mode; channel?: 'text' | 'call'; userMessage: string; context: { rejectedFindings?: RejectedFinding[]; summary: string; recentMessages: { role: 'user' | 'assistant'; text: string }[]; sources: Source[]; sourceSegments?: SourceSegment[]; preferences?: ConversationPreferences; selectedQuestion?: string; practiceCriteria?: string[] }; }
export type CallPhase = 'idle' | 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'muted' | 'paused' | 'error';
export interface CallState { inputWarning?: string; active: boolean; phase: CallPhase; muted: boolean; elapsedSeconds: number; level: number; heardSpeech: boolean; lastHeard: string; caption: string; error: string; }
export interface PracticeSetup { question: string; criteria: string[]; }
export interface TurnCandidate extends RunToken { requestId: string; assistantText: string; findings: Finding[]; cardDraft?: Card; practiceSetup?: PracticeSetup; suggestedMode?: Mode; supportGuidance?: boolean; warnings: string[]; serviceMode: 'mock' | 'real'; }
export interface Capabilities { agent: { mode: 'mock' | 'real'; label: string; configured: boolean }; asr: { available: boolean; label: string; reason?: string }; tts: { available: boolean; label: string; reason?: string; greeting?: string }; limits: { maxInputChars: number; maxSourceChars: number; maxAudioBytes: number; maxRecordingSeconds: number }; processingNotice: string; }
