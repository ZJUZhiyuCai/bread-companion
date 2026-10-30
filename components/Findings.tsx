'use client';

import { useState } from 'react';
import { CircleCheck, CircleSlash, History, PencilLine, Target, TriangleAlert } from 'lucide-react';
import type { Finding, Validity } from '@/domain/types';
import { EvidenceQuote } from './Evidence';
import { KIND_META, KIND_ORDER, VALIDITY_META, viewEvidence, type EvidenceContext } from './labels';

const VALIDITY_ICON: Record<Validity, typeof CircleCheck> = {
  draft: PencilLine,
  confirmed: CircleCheck,
  stale: History,
  disputed: CircleSlash,
};

export function ValidityBadge({ validity, compact = false }: { validity: Validity; compact?: boolean }) {
  const Icon = VALIDITY_ICON[validity];
  const meta = VALIDITY_META[validity];
  return (
    <span className={`validity validity--${validity}`} title={meta.desc}>
      <Icon aria-hidden="true" />
      {meta.label}
      {!compact && <span className="sr-only">：{meta.desc}</span>}
    </span>
  );
}

interface FindingItemProps {
  finding: Finding;
  ctx: EvidenceContext;
  canAct: boolean;
  onReject?: (id: string) => void;
  onPractice?: (question: string) => void;
  onOpenSource?: (id: string) => void;
}

export function FindingItem({ finding, ctx, canAct, onReject, onPractice, onOpenSource }: FindingItemProps) {
  const [confirming, setConfirming] = useState(false);
  const inactive = finding.validity === 'stale' || finding.validity === 'disputed';
  const evidence = finding.evidenceRefs.map((r) => viewEvidence(r, ctx));
  const rejectable = finding.kind !== 'unknown' && !inactive && canAct && !!onReject;

  return (
    <li className={`finding finding--${finding.kind} ${inactive ? 'is-inactive' : ''}`}>
      <div className="finding__head">
        <p className="finding__text">{finding.text}</p>
        {finding.validity !== 'draft' && <ValidityBadge validity={finding.validity} compact />}
      </div>

      {evidence.length > 0 ? (
        <div className="finding__evidence">
          {evidence.map((ev) => (
            <EvidenceQuote key={ev.key} ev={ev} onOpenSource={onOpenSource} />
          ))}
        </div>
      ) : (
        finding.kind !== 'unknown' && (
          <p className="finding__thin">
            <TriangleAlert aria-hidden="true" /> 没有关联到具体摘录，依据有限。
          </p>
        )
      )}

      {(rejectable || (finding.kind === 'practice_suggestion' && onPractice && !inactive && canAct)) && (
        <div className="finding__actions">
          {finding.kind === 'practice_suggestion' && onPractice && !inactive && canAct && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => onPractice(finding.text)}>
              <Target aria-hidden="true" /> 用这道题练一次
            </button>
          )}
          {rejectable &&
            (confirming ? (
              <span className="inline-confirm" role="group" aria-label="确认不认同这条">
                <span className="small">标为有异议后，用到它的卡片需要重新确认。</span>
                <button
                  type="button"
                  className="btn btn--sm btn--warn"
                  onClick={() => {
                    setConfirming(false);
                    onReject?.(finding.id);
                  }}
                >
                  标为有异议
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirming(false)}>
                  算了
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(true)}>
                <CircleSlash aria-hidden="true" /> 我不认同这条
              </button>
            ))}
        </div>
      )}
    </li>
  );
}

interface FindingsSectionProps {
  findings: Finding[];
  ctx: EvidenceContext;
  canAct: boolean;
  onReject: (id: string) => void;
  onPractice: (question: string) => void;
  onOpenSource: (id: string) => void;
}

export function FindingsSection({ findings, ctx, canAct, onReject, onPractice, onOpenSource }: FindingsSectionProps) {
  if (findings.length === 0) {
    return (
      <div className="empty-note">
        <p>还没有分析结果。</p>
        <p className="muted small">
          在“复盘”里放好材料、点“开始复盘”后，这里会把事实、推断和未知分开列出，每条具体判断都附上出处。
        </p>
      </div>
    );
  }
  return (
    <div className="findings">
      {KIND_ORDER.map((kind) => {
        const group = findings.filter((f) => f.kind === kind);
        if (group.length === 0) return null;
        return (
          <section key={kind} className={`findings__group findings__group--${kind}`} aria-labelledby={`fk-${kind}`}>
            <h4 id={`fk-${kind}`} className="findings__title">
              {KIND_META[kind].label}
              <span className="findings__desc">{KIND_META[kind].desc}</span>
            </h4>
            <ul className="findings__list">
              {group.map((f) => (
                <FindingItem
                  key={f.id}
                  finding={f}
                  ctx={ctx}
                  canAct={canAct}
                  onReject={onReject}
                  onPractice={onPractice}
                  onOpenSource={onOpenSource}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
