import type {
  Activity,
  Card,
  EvidenceRef,
  EvidenceSnapshot,
  Finding,
  Mode,
  Origin,
  Source,
  Validity,
} from '@/domain/types';

export type AvatarState = Activity | 'ended';

export const MODE_ORDER: Mode[] = ['listen', 'organize', 'review', 'practice'];

export const MODE_META: Record<Mode, { label: string; hint: string; placeholder: string }> = {
  listen: {
    label: '倾听',
    hint: '只回应你说出来的内容，不做评价。想停随时停。',
    placeholder: '想说什么都可以。比如：“刚收到拒信……”',
  },
  organize: {
    label: '留个记号',
    hint: '把你在意的事整理成一张记号卡。确认的是你的表述，不是拒绝原因。',
    placeholder: '还有想放进记号里的吗？',
  },
  review: {
    label: '复盘',
    hint: '材料原文、你的回忆、推断和未知会分开列出。点“开始复盘”才会分析。',
    placeholder: '可以补充当时的情况，或者直接点“开始复盘”',
  },
  practice: {
    label: '练一题',
    hint: '围绕一道题练一次，只用你真实提供的经历，缺的部分会留空。',
    placeholder: '写下你这一次的回答，发送后得到反馈',
  },
};

export const ACTIVITY_META: Record<AvatarState, { label: string; detail: string }> = {
  idle: { label: '等待中', detail: '没有在录音，也没有在生成' },
  requesting_mic: { label: '等待麦克风授权', detail: '请在浏览器弹窗里选择是否允许' },
  recording: { label: '正在录音', detail: '只录你点击之后的这一段' },
  recorded: { label: '录音已到上限', detail: '已经停止录音，等你决定转写还是放弃' },
  transcribing: { label: '正在转写', detail: '转写结果会先给你修改' },
  generating: { label: '正在整理', detail: '结果核对后才会显示' },
  validating: { label: '正在核对', detail: '检查引用和格式' },
  speaking: { label: '正在说', detail: '点停止可以随时打断' },
  paused: { label: '已暂停', detail: '可以继续说，或者结束' },
  error: { label: '出了点问题', detail: '文字输入仍然可用' },
  ended: { label: '已结束', detail: '不再录音、生成或播放' },
};

export const ORIGIN_ORDER: Origin[] = ['source_quote', 'user_recollection', 'explicit_feedback'];

export const ORIGIN_META: Record<Origin, { label: string; desc: string; example: string }> = {
  source_quote: {
    label: '材料原文',
    desc: '粘贴的材料里确实有的原话，比如岗位描述、笔记',
    example: '比如：岗位描述里的要求',
  },
  user_recollection: {
    label: '我的回忆',
    desc: '你记得的当时情况，不等于完整记录',
    example: '比如：我对 benchmark 那道题的回答',
  },
  explicit_feedback: {
    label: '明确反馈',
    desc: '拒信或面试官明确说过的话，不一定是全部原因',
    example: '比如：拒信原文',
  },
};

export const VALIDITY_META: Record<Validity, { label: string; desc: string }> = {
  draft: { label: '草稿', desc: '还没确认，可以改字或删掉条目' },
  confirmed: { label: '已确认', desc: '你认可了这一版的表述' },
  stale: { label: '已过期', desc: '它依赖的材料被修正过，需要重新整理' },
  disputed: { label: '有异议', desc: '你不认同其中的推断，需要重新整理' },
};

export const KIND_ORDER: Finding['kind'][] = ['reported_fact', 'inference', 'unknown', 'practice_suggestion'];

export const KIND_META: Record<Finding['kind'], { label: string; desc: string }> = {
  reported_fact: { label: '你提供的事实', desc: '来自你的材料或回忆' },
  inference: { label: '推断', desc: '可能的解释，不是定论' },
  unknown: { label: '未知', desc: '现有信息回答不了，不替招聘方下结论' },
  practice_suggestion: { label: '练习建议', desc: '可以练的方向，依据见下方摘录' },
};

export const CARD_TYPE_LABEL: Record<Card['type'], string> = {
  note: '记号卡',
  review: '复盘卡',
};

const SECTION_ALIASES: [string[], string][] = [
  [['focus', 'mainpoint', 'keypoint', 'concern', 'care', 'caremost', 'highlight'], '我最在意的一件事'],
  [['revisit', 'question', 'laterquestion', 'revisitquestion', 'followup', 'questions'], '以后想再看的问题'],
  [['unknown', 'unknowns', 'open', 'openquestions'], '目前不知道的事'],
  [['nextstep', 'next', 'nextaction', 'choice'], '我选择的下一步'],
  [['background', 'context', 'interview', 'interviewcontext'], '面试背景'],
  [['sources', 'sourcequotes', 'excerpts', 'quotes', 'evidence'], '来源片段'],
  [['confirmed', 'facts', 'confirmedfacts', 'reportedfacts'], '已确认内容'],
  [['strengths', 'strength', 'existingstrengths', 'performance', 'evidencedstrengths'], '有依据的已有表现'],
  [['improvement', 'improve', 'improvementpoint', 'gap', 'onething'], '一个可改进点'],
  [['inferences', 'inference', 'inferenceunknown', 'inferencesandunknowns', 'inferencesunknowns'], '推断与未知'],
  [['practice', 'practiceversion', 'practicequestion', 'practiceoutline'], '练习版本'],
  [['action', 'smallaction', 'nextsmallaction', 'myaction'], '我选择的小行动'],
];

const SECTION_LOOKUP = new Map<string, string>();
for (const [keys, label] of SECTION_ALIASES) for (const k of keys) SECTION_LOOKUP.set(k, label);

/** Section keys come from the domain; map the likely ones to readable titles, otherwise show as-is. */
export function sectionLabel(key: string): string {
  if (/[一-鿿]/.test(key)) return key;
  const norm = key.replace(/[-_\s]/g, '').toLowerCase();
  return SECTION_LOOKUP.get(norm) ?? key;
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Findings referenced by the card's sections, in section order, without duplicates. */
export function cardFindings(card: Card, findings: Finding[]): Finding[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const section of card.sections) {
    for (const id of section.findingIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const f = byId.get(id);
      if (f) out.push(f);
    }
  }
  return out;
}

export interface EvidenceView {
  key: string;
  quote: string;
  sourceId: string;
  sourceRevision: number;
  segmentId: string;
  origin: Origin | null;
  confirmed: boolean | null;
  label: string;
  /** Source was corrected after this quote was taken. */
  outdated: boolean;
  /** No matching source / snapshot entry was found. */
  missing: boolean;
}

export interface EvidenceContext {
  /** Live sources during an active session. */
  sources: Source[] | null;
  /** Frozen evidence from the end snapshot or a saved case. */
  snapshot: EvidenceSnapshot[] | null;
}

export function evidenceKey(ref: EvidenceRef): string {
  return `${ref.sourceId}@${ref.sourceRevision}#${ref.segmentId}`;
}

export function viewEvidence(ref: EvidenceRef, ctx: EvidenceContext): EvidenceView {
  const base = {
    key: evidenceKey(ref),
    quote: ref.quote,
    sourceId: ref.sourceId,
    sourceRevision: ref.sourceRevision,
    segmentId: ref.segmentId,
  };
  if (ctx.snapshot) {
    const snap = ctx.snapshot.find(
      (e) => e.sourceId === ref.sourceId && e.segmentId === ref.segmentId && e.sourceRevision === ref.sourceRevision,
    );
    return {
      ...base,
      origin: snap?.origin ?? null,
      confirmed: snap?.confirmed ?? null,
      label: snap ? ORIGIN_META[snap.origin].label : '摘录',
      outdated: false,
      missing: !snap,
    };
  }
  const src = ctx.sources?.find((s) => s.id === ref.sourceId);
  return {
    ...base,
    origin: src?.origin ?? null,
    confirmed: src?.confirmed ?? null,
    label: src?.label || (src ? ORIGIN_META[src.origin].label : '已不在本次会话的材料'),
    outdated: !!src && src.revision !== ref.sourceRevision,
    missing: !src,
  };
}

/** Only the quotes the card actually cites — what the save preview must list. */
export function cardEvidence(card: Card, findings: Finding[], ctx: EvidenceContext): EvidenceView[] {
  const out = new Map<string, EvidenceView>();
  for (const f of cardFindings(card, findings)) {
    for (const ref of f.evidenceRefs) {
      const k = evidenceKey(ref);
      if (!out.has(k)) out.set(k, viewEvidence(ref, ctx));
    }
  }
  return [...out.values()];
}
