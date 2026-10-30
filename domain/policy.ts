import type { Mode } from './types';

// Exact unambiguous commands only. Negation wins; source material is never passed to this function.
export function explicitIntent(text: string): Mode | 'stop' | 'end' | null {
  const t = text.trim().replace(/[。！!，,？?\s]+$/g, '');
  if (/^(停止|停一下|暂停|先停一下|别说了)$/.test(t)) return 'stop';
  if (/^(结束|结束会话|今天到这里|今晚到这里|今晚先到这里)$/.test(t)) return 'end';
  if (/^(今晚)?(不想|不要|先不|不)(复盘|分析|评价)(了)?$/.test(t)) return 'listen';
  if (/^(请)?(直接|现在|帮我|我想|我想直接)?复盘$/.test(t)) return 'review';
  if (/^请(根据我提供的材料做一次|按修正后的材料重新|根据已确认的原话)复盘$/.test(t)) return 'review';
  if (/^(请)?(帮我)?(留个记号|整理一下|留一个记号)$/.test(t)) return 'organize';
  if (t === '请按修正后的内容重新整理记号') return 'organize';
  return null;
}
// Deliberately narrow current-first-person pattern; ordinary distress, negation and quotes do not trigger it.
// This is a routing aid, not a complete risk detector. Model judgment remains fallible too.
export function needsImmediateSupport(text: string): boolean {
  const t = text.trim();
  if (/[“”「」『』"<>]|以前|曾经|去年|朋友说|不想|不会|没有|不打算|小说|引用/.test(t)) return false;
  return /^(我现在|我今晚|我马上|我正在)(要|想|打算|准备)?(自杀|伤害自己|结束生命|跳楼|割腕|吞药)/.test(t);
}
export const SUPPORT_TEXT = '先把面试放一边。如果你现在可能伤害自己，请先远离可能伤到你的物品，去有人的地方，联系一个你信任的人陪着你。如果危险迫在眼前，请联系当地急救或紧急服务。这里是 AI，无法提供现场救援。你仍可以随时停止或退出。';
