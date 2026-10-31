import { savedCaseSchema } from '@/domain/schemas';
import { refKey } from '@/domain/evidence';
import type { EndSnapshot, SavedCase } from '@/domain/types';

const DB = 'bread-local-cards'; const STORE = 'cases';
const generations = new Map<string, number>();
export const MAX_IMPORT_BYTES = 1024 * 1024;
function generation(id: string) { return generations.get(id) ?? 0; }
export function validateArchive(value: unknown): SavedCase {
  const data = savedCaseSchema.parse(value);
  const findingIds = new Set(data.findings.map(f => f.id));
  if (findingIds.size !== data.findings.length) throw new Error('重复的内容编号');
  const cardKeys = new Set(data.cards.map(c => `${c.id}:${c.revision}`));
  if (cardKeys.size !== data.cards.length) throw new Error('重复的卡片版本');
  if (data.cards.some(c => c.caseId !== data.caseId || !['confirmed', 'stale', 'disputed'].includes(c.validity) || (c.parentRevision !== null && c.parentRevision >= c.revision))) throw new Error('卡片版本无效');
  const evidence = new Map(data.selectedEvidence.map(e => [refKey(e), e]));
  if (evidence.size !== data.selectedEvidence.length) throw new Error('重复的引用');
  const usedFindings = new Set(data.cards.flatMap(c => c.sections.flatMap(s => s.findingIds)));
  if ([...usedFindings].some(id => !findingIds.has(id)) || data.findings.some(f => !usedFindings.has(f.id))) throw new Error('内容关联不完整');
  const usedEvidence = new Set(data.findings.flatMap(f => f.evidenceRefs.map(refKey)));
  if ([...usedEvidence].some(key => !evidence.has(key)) || [...evidence.keys()].some(key => !usedEvidence.has(key))) throw new Error('引用关联不完整');
  for (const card of data.cards.filter(c => c.validity === 'confirmed')) {
    const linked = data.findings.filter(f => card.sections.some(s => s.findingIds.includes(f.id)));
    if (linked.some(f => f.validity !== 'confirmed' || f.evidenceRefs.some(e => !evidence.get(refKey(e))?.confirmed))) throw new Error('确认版本含未确认内容');
  }
  return data;
}
export function fromSnapshot(snapshot: EndSnapshot): SavedCase {
  if (snapshot.card.validity !== 'confirmed' || snapshot.findings.some(f => f.validity !== 'confirmed')) throw new Error('请先确认有效的卡片版本');
  return validateArchive({ schemaVersion: 1, caseId: snapshot.card.caseId, savedAt: new Date().toISOString(), cards: [snapshot.card], findings: snapshot.findings, selectedEvidence: snapshot.evidence, confirmedPractice: snapshot.confirmedPractice });
}
export function parseImport(text: string): SavedCase {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error('JSON 文件超过 1 MiB 上限');
  return validateArchive(JSON.parse(text));
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('此浏览器无法使用本地存储')); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'caseId' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('无法打开本地存储'));
    request.onblocked = () => reject(new Error('本地存储被另一页面占用'));
  });
}
export async function listSaved(): Promise<SavedCase[]> {
  const db = await openDb();
  try { return await new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => { try { resolve(req.result.map(validateArchive).sort((a, b) => b.savedAt.localeCompare(a.savedAt))); } catch { reject(new Error('存档校验失败，未加载不完整的记录')); } };
    req.onerror = () => reject(new Error('无法读取本地存档'));
  }); } finally { db.close(); }
}
export async function saveArchive(input: SavedCase, isStillValid: () => boolean = () => true): Promise<void> {
  const data = structuredClone(validateArchive(input)); // freeze the selected version before ANY await
  const capturedGeneration = generation(data.caseId);
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => {
    if (!isStillValid() || generation(data.caseId) !== capturedGeneration) { reject(new Error('此版本已失效或案例已删除')); return; }
    const tx = db.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE);
    const get = store.get(data.caseId);
    let failure: Error | null = null;
    get.onsuccess = () => {
      try {
        if (!isStillValid() || generation(data.caseId) !== capturedGeneration) throw new Error('此版本已失效或案例已删除');
        const old = get.result ? validateArchive(get.result) : null;
        if (old) {
          // Same id + revision may be saved repeatedly, but cannot silently be replaced by imported content.
          for (const card of data.cards) {
            const existing = old.cards.find(c => c.id === card.id && c.revision === card.revision);
            if (existing && JSON.stringify(existing) !== JSON.stringify(card)) throw new Error('同一版本已有不同内容，请作为新案例导入');
          }
        }
        const merge = <T,>(a: T[], b: T[], key: (v: T) => string): T[] => [...new Map([...a, ...b].map(v => [key(v), v])).values()];
        const merged = old ? validateArchive({ ...data, cards: merge(old.cards, data.cards, c => `${c.id}:${c.revision}`), findings: merge(old.findings, data.findings, f => f.id), selectedEvidence: merge(old.selectedEvidence, data.selectedEvidence, refKey), confirmedPractice: merge(old.confirmedPractice, data.confirmedPractice, p => p.id) }) : data;
        store.put(merged);
      } catch (e) { failure = e instanceof Error ? e : new Error('保存失败'); tx.abort(); }
    };
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(failure ?? new Error('没有保存成功，可能空间不足或存储被禁用'));
  }); } finally { db.close(); }
}
export async function deleteSavedCase(caseId: string): Promise<void> {
  generations.set(caseId, generation(caseId) + 1); // wins over pending saves, including before opening IDB
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(caseId);
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('删除未完成，请重试'));
  }); } finally { db.close(); }
}
export async function invalidateSaved(caseId: string, sourceId?: string, findingId?: string, throughSourceRevision = Infinity): Promise<void> {
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE); const req = store.get(caseId);
    req.onsuccess = () => {
      if (!req.result) return;
      const data = validateArchive(req.result);
      // A delayed correction must not invalidate cards already rebuilt from the newer wording.
      const bad = new Set(data.findings.filter(f => f.id === findingId || f.evidenceRefs.some(r => r.sourceId === sourceId && r.sourceRevision <= throughSourceRevision)).map(f => f.id));
      data.findings = data.findings.map(f => bad.has(f.id) ? { ...f, validity: findingId ? 'disputed' : 'stale' } : f);
      data.cards = data.cards.map(c => c.sections.some(s => s.findingIds.some(id => bad.has(id))) ? { ...c, validity: findingId ? 'disputed' : 'stale' } : c);
      store.put(data);
    };
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('历史存档状态未更新，请重试或删除该案例'));
  }); } finally { db.close(); }
}
