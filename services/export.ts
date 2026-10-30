import type { SavedCase } from '@/domain/types';
import { validateArchive } from './card-store';
export function toMarkdown(input: SavedCase): string {
  const data = validateArchive(input);
  // Indent all untrusted prose to avoid Markdown HTML/link execution in downstream readers.
  const plain = (s: string) => s.split('\n').map(line => `    ${line}`).join('\n');
  return ['# 面包 · 已确认材料', '', '保存在本设备或由本人主动导出的版本。确认表示认可表述，不代表外部事实已经核验。', '',
    ...data.cards.flatMap(c => [`## 卡片 · 版本 ${c.revision}`, '', plain(c.title), '', `状态：${c.validity} · ${c.serviceMode === 'mock' ? '规则演示（Mock）' : '真实模型候选，经本人确认'}`, '', ...c.sections.flatMap(s => [plain(s.key), '', plain(s.text || '（留空）'), ''])]),
    '## 选定的来源摘录', '', ...data.selectedEvidence.flatMap(e => [`来源 ${e.sourceId} · 修订 ${e.sourceRevision} · ${e.origin}`, '', plain(e.quote), '']),
    '未包含完整聊天、原始音频或未选中的材料。', '' ].join('\n');
}
export function downloadArchive(input: SavedCase, format: 'md' | 'json') {
  const data = validateArchive(input);
  const blob = new Blob([format === 'json' ? JSON.stringify(data, null, 2) : toMarkdown(data)], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = `面包-${data.caseId.slice(-8)}.${format}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
