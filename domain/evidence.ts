import type { Card, EvidenceRef, EvidenceSnapshot, Finding, Source, TurnCandidate, TurnRequest } from './types';

export function segments(source: Source): { id: string; text: string }[] {
  const result: { id: string; text: string }[] = [];
  // Array.from avoids splitting surrogate pairs at segment boundaries. No offset coordinates escape this function.
  const chars = Array.from(source.text);
  for (let i = 0; i < chars.length; i += 500) result.push({ id: `${source.id}:r${source.revision}:s${result.length}`, text: chars.slice(i, i + 500).join('') });
  return result;
}
export function locateEvidence(sources: Source[], ref: EvidenceRef, requireConfirmed = false): boolean {
  const source = sources.find(s => s.id === ref.sourceId && s.revision === ref.sourceRevision);
  return !!source && (!requireConfirmed || source.confirmed) && segments(source).some(s => s.id === ref.segmentId && s.text.includes(ref.quote));
}
export function refKey(ref: EvidenceRef): string { return JSON.stringify([ref.sourceId, ref.sourceRevision, ref.segmentId, ref.quote]); }
export function firstReference(source: Source): EvidenceRef {
  const seg = segments(source)[0];
  return { sourceId: source.id, sourceRevision: source.revision, segmentId: seg.id, quote: Array.from(seg.text).slice(0, 200).join('') };
}
export function linkedFindings(card: Card, findings: Finding[]): Finding[] {
  const ids = new Set(card.sections.flatMap(s => s.findingIds));
  return findings.filter(f => ids.has(f.id));
}
export function evidenceSnapshots(card: Card, findings: Finding[], sources: Source[]): EvidenceSnapshot[] {
  const refs = linkedFindings(card, findings).flatMap(f => f.evidenceRefs);
  return [...new Map(refs.map(r => [refKey(r), r])).values()].map(r => {
    const s = sources.find(s => s.id === r.sourceId && s.revision === r.sourceRevision);
    if (!s || !locateEvidence(sources, r)) throw new Error('EVIDENCE_MISMATCH');
    return { ...r, origin: s.origin, confirmed: s.confirmed };
  });
}
export function validateCandidate(candidate: TurnCandidate, input: TurnRequest): string[] {
  const errors: string[] = [];
  for (const key of ['requestId', 'sessionId', 'runId', 'epoch', 'contextRevision'] as const) if (candidate[key] !== input[key]) errors.push('STALE_RESULT');
  const preparingPractice = input.mode === 'practice' && !input.context.selectedQuestion;
  if (candidate.practiceSetup && (!preparingPractice || candidate.supportGuidance)) errors.push('PRACTICE_SETUP_NOT_REQUESTED');
  if (preparingPractice && !candidate.supportGuidance && !candidate.practiceSetup) errors.push('PRACTICE_SETUP_REQUIRED');
  if (preparingPractice && (candidate.findings.length || candidate.cardDraft)) errors.push('PRACTICE_ANSWER_REQUIRED');
  if (input.mode === 'listen' && (candidate.findings.length || candidate.cardDraft)) errors.push('MODE_VIOLATION');
  if (input.mode === 'listen' && candidate.assistantText.length > 240) errors.push('REPLY_TOO_LONG');
  if (input.mode === 'organize' && candidate.findings.some(f => f.kind === 'inference' || f.kind === 'practice_suggestion')) errors.push('MODE_VIOLATION');
  if (input.mode === 'organize' && candidate.cardDraft?.type === 'review') errors.push('MODE_VIOLATION');
  if (candidate.supportGuidance && (candidate.findings.length || candidate.cardDraft)) errors.push('SUPPORT_MODE_VIOLATION');
  if (new Set(candidate.findings.map(f => f.id)).size !== candidate.findings.length) errors.push('DUPLICATE_FINDING');
  for (const f of candidate.findings) {
    if (f.validity !== 'draft') errors.push('MODEL_CANNOT_CONFIRM');
    if (['reported_fact', 'inference'].includes(f.kind) && !f.evidenceRefs.length) errors.push('EVIDENCE_REQUIRED');
    if (f.kind === 'practice_suggestion' && !f.evidenceRefs.length && !/通用|材料有限|材料不足/.test(f.text)) errors.push('EVIDENCE_REQUIRED');
    for (const ref of f.evidenceRefs) if (!locateEvidence(input.context.sources, ref, input.mode === 'review' || input.mode === 'practice')) errors.push('EVIDENCE_MISMATCH');
  }
  if (candidate.cardDraft) {
    if (candidate.cardDraft.validity !== 'draft') errors.push('MODEL_CANNOT_CONFIRM');
    const ids = new Set(candidate.findings.map(f => f.id));
    for (const s of candidate.cardDraft.sections) if (s.findingIds.some(id => !ids.has(id))) errors.push('MISSING_FINDING');
    // Every substantive generated section is traceable to validated findings.
    for (const s of candidate.cardDraft.sections) if (s.text.trim() && !s.findingIds.length) errors.push('UNSUPPORTED_SECTION');
  }
  return [...new Set(errors)];
}
export function cardCanConfirm(card: Card, findings: Finding[], sources: Source[]): boolean {
  if (card.validity === 'stale' || card.validity === 'disputed') return false;
  const ids = card.sections.flatMap(s => s.findingIds);
  const linked = linkedFindings(card, findings);
  return ids.every(id => linked.some(f => f.id === id)) && linked.every(f => !['stale', 'disputed'].includes(f.validity) && f.evidenceRefs.every(r => locateEvidence(sources, r, true)));
}
