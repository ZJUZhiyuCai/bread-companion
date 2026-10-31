import type {
  Activity,
  Card,
  EvidenceRef,
  EvidenceSnapshot,
  Finding,
  Mode,
  Origin,
  SavedCase,
  Source,
  Validity,
} from '@/domain/types';

export type AvatarState = Activity | 'ended';

/** What the loaf says it is doing. Plain text, so state never depends on color or animation alone. */
export const ACTIVITY_META: Record<AvatarState, { label: string; detail: string }> = {
  idle: { label: '在这儿', detail: '没有在录音，也没有在生成' },
  requesting_mic: { label: '等你允许麦克风', detail: '在浏览器弹窗里选择；不允许就不会录' },
  recording: { label: '在录这一段', detail: '只录你点击之后的这一段' },
  recorded: { label: '录满了，先停下了', detail: '已录的部分还在，等你决定' },
  transcribing: { label: '在把录音转成字', detail: '转好先给你改，不会自动发出' },
  generating: { label: '在想', detail: '想好、核对过才会一起给你' },
  validating: { label: '在核对', detail: '检查引用和格式' },
  speaking: { label: '在念给你听', detail: '点“停止”随时打断' },
  paused: { label: '停下了', detail: '想继续就接着说' },
  error: { label: '出了点小问题', detail: '文字还可以照常用' },
  ended: { label: '已结束', detail: '不再录音、生成或播放' },
};

export const WORKING_STATES: AvatarState[] = [
  'requesting_mic',
  'recording',
  'recorded',
  'transcribing',
  'generating',
  'validating',
  'speaking',
];

/**
 * A modal makes the page behind it inert, including 停止. Things that shouldn't keep going out of reach
 * (microphone, transcription, generation or audio) are stopped first.
 */
export const STOP_BEFORE_MODAL: AvatarState[] = [...WORKING_STATES];

/** The single line shown when the agent is doing something other than just talking. */
export const DOING_META: Record<Mode, string | null> = {
  listen: null,
  organize: '在把你说过的话留成一张记号',
  review: '在一起看那段回答',
  practice: '在练一题',
};

export const ORIGIN_META: Record<Origin, { label: string; desc: string }> = {
  source_quote: { label: '你放进来的材料', desc: '你粘贴的原文。确实是你提交的文字，不代表外部事实已核实' },
  user_recollection: { label: '你的回忆', desc: '你记得的当时情况，不等于完整记录' },
  explicit_feedback: { label: '明确反馈', desc: '拒信或面试官明确说过的话，不一定是全部原因' },
};

export const VALIDITY_META: Record<Validity, { label: string; desc: string }> = {
  draft: { label: '草稿 · 可以改', desc: '还没留下，可以改字或删掉一栏' },
  confirmed: { label: '已确认', desc: '你认可了这一版的写法' },
  stale: { label: '需要重新整理', desc: '它用到的材料被你改过了' },
  disputed: { label: '需要重新整理', desc: '你不认同其中一条' },
};

export const KIND_ORDER: Finding['kind'][] = ['reported_fact', 'inference', 'unknown', 'practice_suggestion'];

export const KIND_META: Record<Finding['kind'], { label: string; desc: string }> = {
  reported_fact: { label: '你说过的 / 材料里有的', desc: '来自你的话或你放进来的材料' },
  inference: { label: '可能的解释', desc: '只是一种看法，不是定论' },
  unknown: { label: '还不知道的', desc: '现有信息回答不了，不替招聘方下结论' },
  practice_suggestion: { label: '可以练的', desc: '一个能练的小地方' },
};

export const CARD_TYPE_LABEL: Record<Card['type'], string> = {
  note: '记号',
  review: '复盘小票',
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

export function isLocked(v: Validity): boolean {
  return v === 'stale' || v === 'disputed';
}

/** Has this exact card version reached the local archive? Only a real saved record counts. */
export function isCardSaved(card: Card | null, saved: SavedCase[]): boolean {
  if (!card || isLocked(card.validity)) return false;
  return saved.some((c) => c.caseId === card.caseId && c.cards.some((k) => k.id === card.id && k.revision === card.revision && k.validity === 'confirmed' && k.title === card.title && JSON.stringify(k.sections) === JSON.stringify(card.sections)));
}

export function latestCard(c: SavedCase): Card | null {
  if (c.cards.length === 0) return null;
  return [...c.cards].sort((a, b) => b.revision - a.revision)[0];
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
    label: src?.label || (src ? ORIGIN_META[src.origin].label : '已不在这次对话里的材料'),
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
