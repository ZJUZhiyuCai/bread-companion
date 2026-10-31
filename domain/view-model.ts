import type { CallState, Capabilities, Card, Mode, Origin, SavedCase, SessionState } from './types';
/** Stable frontend boundary. Codex implements services/use-bread.ts; Claude owns UI. */
export interface BreadViewModel {
  state: SessionState;
  capabilities: Capabilities | null;
  currentCard: Card | null;
  savedCases: SavedCase[];
  notice: string;
  error: string;
  transcriptDraft: string;
  recordedSeconds: number;
  busy: boolean;
  canRetry: boolean;
  /** Retries the failed text turn without adding a second user message or source. */
  retryLastTurn: () => Promise<void>;
  call: CallState;
  /** User initiated, continuous voice conversation; never a real telephone/PSTN call. */
  startCall: () => Promise<void>;
  hangupCall: () => void;
  toggleCallMute: () => void;
  interruptCall: () => void;
  finishCallTurn: () => void;
  resumeCall: () => Promise<void>;
  start: (mode?: Mode, welcome?: boolean) => void;
  send: (text: string) => Promise<void>;
  assist: (mode: Exclude<Mode, 'listen'>) => Promise<void>;
  addMaterial: (text: string) => boolean;
  setMode: (mode: Mode) => void;
  stop: () => void;
  end: () => void;
  reset: () => void;
  addSource: (text: string, origin: Origin, label: string) => void;
  correctSource: (id: string, text: string) => void;
  confirmSource: (id: string) => void;
  rejectFinding: (id: string) => void;
  editCard: (title: string, sections: Card['sections']) => void;
  confirmCard: () => void;
  saveCard: () => Promise<void>;
  exportCard: (format: 'md' | 'json') => void;
  refreshSaved: () => Promise<void>;
  deleteSaved: (caseId: string) => Promise<void>;
  importSaved: (file: File) => Promise<void>;
  resumeSaved: (saved: SavedCase) => void;
  setPractice: (question: string, criteria: string[]) => void;
  startRecording: () => Promise<void>;
  finishRecording: () => Promise<void>;
  transcribeRecorded: () => Promise<void>;
  cancelRecording: () => void;
  setTranscriptDraft: (text: string) => void;
  sendTranscript: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  clearNotice: () => void;
}
