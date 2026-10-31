import type { Mode } from './types';

/** Only direct, unambiguous leave-taking. Quoted stories, requests and ambiguous prefixes go to the model. */
export function farewellReply(text: string): string | null {
  const parts = text.trim().replace(/[。！!，,\s]+$/g, '').split(/[。！!，,\n]+/).map(s => s.trim());
  const last = parts.pop();
  if (!last || !/^(?:晚点(?:再)?(?:聊|说)|一会儿再聊|回头聊|明天(?:再)?聊|改天(?:再)?聊|拜拜|再见|晚安|先不聊了|今天(?:就)?到这(?:里)?)$/.test(last)) return null;
  if (!parts.every(s => /^(?:好(?:的|吧)?|行|嗯|那(?:就)?先这样|今天先这样|我(?:先)?(?:去|要)?(?:吃饭|睡觉|休息|出门|上班|洗澡|忙一会儿?)(?:了)?)$/.test(s))) return null;
  if (last === '晚安') return '晚安。';
  if (/^(?:拜拜|再见)$/.test(last)) return '拜拜。';
  if (/^(?:先不聊了|今天)/.test(last)) return '好，那先这样。';
  return /明天/.test(last) ? '好，明天聊。' : '好，回头聊。';
}

// Direct requests only. Quoted material is not a command, and declining analysis takes priority.
export function explicitIntent(text: string): Mode | 'stop' | 'end' | null {
  const t = text.trim().replace(/[。！!，,？?\s]+$/g, '');
  if (/^(停止|停一下|暂停|先停一下|别说了)$/.test(t)) return 'stop';
  if (/^(结束|结束会话|今天到这里|今晚到这里|今晚先到这里)$/.test(t)) return 'end';
  if (/^[“”「」『』"']|^(他说|她说|面试官说|原文|引用|假如|如果)/.test(t)) return null;
  if (/^(我们)?(一起)?练习(过|了|的时候|之后)/.test(t)) return null;
  if (/^(我)?(现在|今天|今晚|暂时|还是)?(真的)?(不想|不要|先不|不|先别|别)(再)?(复盘|分析|评价|练习|练题|练了)/.test(t)) return 'listen';
  if (/^(我)?(现在|今天|今晚|暂时|还是)?(只想|想先|就想)(聊聊|说说|说话|被听见|倾诉|吐槽)/.test(t)) return 'listen';
  if (/^(我们)?先聊(聊|聊天|一会)/.test(t)) return 'listen';
  if (/^(今晚)?(不想|不要|先不|不)(复盘|分析|评价)(了)?$/.test(t)) return 'listen';
  if (/^(请)?(直接|现在|帮我|我想|我想直接)?复盘$/.test(t)) return 'review';
  if (/^请(根据我提供的材料做一次|按修正后的材料重新|根据已确认的原话)复盘$/.test(t)) return 'review';
  if (/^(请)?(帮我)?(留个记号|整理一下|留一个记号)$/.test(t)) return 'organize';
  if (t === '请按修正后的内容重新整理记号') return 'organize';
  if (/^(请)?(帮我|陪我|我们|我想|我想要|现在|接下来)(一起)?(复盘|分析一下|看看.{0,12}(回答|面试|哪里)|梳理.{0,8}面试)/.test(t)) return 'review';
  if (/^(请)?(帮我|陪我|我们|我想|我想要|现在|接下来)?(一起)?(练一[题道次下]|练习|练练|开始练|换一[题道])/.test(t)) return 'practice';
  if (/^(请)?(帮我|给我|我想|我想要)?(把.{0,20})?(整理一下|留个记号|留一个记号|记下来|整理成|留张|留一张)/.test(t)) return 'organize';
  return null;
}
// Only pure action requests are excluded from evidence selection. A request containing
// an interview excerpt remains ordinary user material; its content must not disappear.
export function isActionOnly(text: string): boolean {
  const t = text.trim().replace(/[。！!，,？?\s]+$/g, '');
  return /^(请)?(帮我)?(直接复盘|复盘|整理一下|留个记号|留一个记号)$/.test(t)
    || /^(请根据我提供的材料做一次复盘|请按修正后的材料重新复盘|请根据已确认的原话复盘|请按修正后的内容重新整理记号|帮我把刚才说的留个记号|帮我复盘一下刚才的面试片段|陪我练一题，请根据我们聊过的内容选一个问题)$/.test(t);
}
// Deliberately narrow current-first-person pattern; ordinary distress, negation and quotes do not trigger it.
// This is a routing aid, not a complete risk detector. Model judgment remains fallible too.
export function needsImmediateSupport(text: string): boolean {
  const t = text.trim();
  if (/[“”「」『』"<>]|以前|曾经|去年|朋友说|不想|不会|没有|不打算|小说|引用/.test(t)) return false;
  return /^(我现在|我今晚|我马上|我正在)(要|想|打算|准备)?(自杀|伤害自己|结束生命|跳楼|割腕|吞药)/.test(t);
}
export const SUPPORT_TEXT = '先把面试放一边。如果你现在可能伤害自己，请先远离可能伤到你的物品，去有人的地方，联系一个你信任的人陪着你。如果危险迫在眼前，请联系当地急救或紧急服务。这里是 AI，无法提供现场救援。你仍可以随时停止或退出。';
