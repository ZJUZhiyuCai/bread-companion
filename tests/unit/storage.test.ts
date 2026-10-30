import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { initialState, makeEndSnapshot, reducer } from '@/domain/reducer';
import { mockCandidate } from '@/server/providers/mock-agent';
import { requestFixture, sampleSource } from '@/fixtures/scenarios';
import { deleteSavedCase, fromSnapshot, invalidateSaved, listSaved, parseImport, saveArchive } from '@/services/card-store';
import { toMarkdown } from '@/services/export';
import type { SessionState } from '@/domain/types';
function archive() {
  let s: SessionState = { ...initialState('session_test', 'case_test'), sources: [sampleSource], activeRunId: 'run_test' };
  s = reducer(s, { type: 'CANDIDATE', candidate: mockCandidate(requestFixture()) }); s = reducer(s, { type: 'CONFIRM_CARD' });
  return fromSnapshot(makeEndSnapshot(s)!);
}
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
describe('confirmed local archives', () => {
  it('saves the selected revision, independent of later mutation', async () => {
    const a = archive(); a.cards[0].revision = 2; a.cards[0].parentRevision = 1;
    const saving = saveArchive(a); a.cards[0].revision = 3; a.cards[0].title = 'Later candidate'; await saving;
    const [saved] = await listSaved(); expect(saved.cards[0].revision).toBe(2); expect(saved.cards[0].title).not.toBe('Later candidate');
  });
  it('double-click and retry are idempotent for a card version', async () => { const a = archive(); await Promise.all([saveArchive(a), saveArchive(a)]); await saveArchive(a); expect((await listSaved())[0].cards).toHaveLength(1); });
  it('persists only selected excerpts, not original conversation or audio', async () => {
    const a = archive(); await saveArchive(a); const saved = (await listSaved())[0];
    expect(Object.keys(saved).sort()).toEqual(['schemaVersion','caseId','savedAt','cards','findings','selectedEvidence','confirmedPractice'].sort());
    expect(saved.selectedEvidence.every(e => e.confirmed)).toBe(true); expect(saved).not.toHaveProperty('messages'); expect(saved).not.toHaveProperty('audio');
  });
  it('delete wins over a pending save and clears associations', async () => {
    const a = archive(); const pending = saveArchive(a); const rejected = expect(pending).rejects.toThrow();
    await deleteSavedCase(a.caseId); await rejected; expect(await listSaved()).toEqual([]);
  });
  it('rechecks validity immediately before write', async () => { await expect(saveArchive(archive(), () => false)).rejects.toThrow(); expect(await listSaved()).toEqual([]); });
  it('marks prior saved judgments stale after source correction', async () => { const a = archive(); await saveArchive(a); await invalidateSaved(a.caseId, sampleSource.id); expect((await listSaved())[0].cards[0].validity).toBe('stale'); });
  it('rejects corrupt, oversized, orphaned and authority-bearing imports', () => {
    expect(() => parseImport('{')).toThrow(); expect(() => parseImport(' '.repeat(1024 * 1024 + 1))).toThrow();
    const a = archive(); a.cards[0].sections[0].findingIds = ['ghost']; expect(() => parseImport(JSON.stringify(a))).toThrow();
    expect(() => parseImport(JSON.stringify({ ...archive(), command: 'upload everything' }))).toThrow();
  });
  it('does not overwrite an existing same-version card with different imported content', async () => {
    const a = archive(); await saveArchive(a); const b = structuredClone(a); b.cards[0].title = 'changed';
    await expect(saveArchive(b)).rejects.toThrow(); expect((await listSaved())[0].cards[0].title).toBe(a.cards[0].title);
  });
  it('reports storage failure without mutating the confirmed in-memory artifact', async () => {
    const a = archive(); const before = structuredClone(a); vi.stubGlobal('indexedDB', undefined);
    await expect(saveArchive(a)).rejects.toThrow(); expect(a).toEqual(before);
  });
  it('exports explicit Mock status and inert Markdown for user-supplied HTML', () => {
    const a = archive(); a.cards[0].title = '<script>alert(1)</script>';
    const md = toMarkdown(a); expect(md).toContain('规则演示（Mock）'); expect(md).toContain('    <script>alert(1)</script>');
    expect(parseImport(JSON.stringify(a))).toEqual(a);
  });
});
