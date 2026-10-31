'use client';

import { useState } from 'react';
import { ChevronDown, CircleCheck, CircleHelp, CircleSlash, History, Lightbulb, MessageSquareQuote, PencilLine, Target } from 'lucide-react';
import type { Finding, Validity } from '@/domain/types';
import { EvidenceQuote } from './Evidence';
import { KIND_META, KIND_ORDER, VALIDITY_META, isLocked, viewEvidence, type EvidenceContext } from './labels';

const VALIDITY_ICON: Record<Validity, typeof CircleCheck> = {
  draft: PencilLine,
  confirmed: CircleCheck,
  stale: History,
  disputed: CircleSlash,
};

const KIND_ICON: Record<Finding['kind'], typeof CircleCheck> = {
  reported_fact: MessageSquareQuote,
  inference: Lightbulb,
  unknown: CircleHelp,
  practice_suggestion: Target,
};

export function ValidityBadge({ validity }: { validity: Validity }) {
  const Icon = VALIDITY_ICON[validity];
  const meta = VALIDITY_META[validity];
  return (
    <span className={`validity validity--${validity}`} title={meta.desc}>
      <Icon aria-hidden="true" />
      {meta.label}
      <span className="sr-only">：{meta.desc}</span>
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
  const inactive = isLocked(finding.validity);
  const evidence = finding.evidenceRefs.map((r) => viewEvidence(r, ctx));
  const rejectable = finding.kind !== 'unknown' && !inactive && canAct && !!onReject;
  const practicable = finding.kind === 'practice_suggestion' && !!onPractice && !inactive && canAct;

  return (
    <li className={`finding finding--${finding.kind} ${inactive ? 'is-inactive' : ''}`}>
      <p className="finding__text">{finding.text}</p>
      {inactive && <ValidityBadge validity={finding.validity} />}

      {evidence.length > 0 ? (
        <details className="basis">
          <summary>
            <ChevronDown aria-hidden="true" className="basis__chev" />
            出处 {evidence.length} 处
            {evidence.some((e) => e.outdated || e.missing) && <span className="flag">有过期的</span>}
          </summary>
          <div className="basis__body">
            {evidence.map((ev) => (
              <EvidenceQuote key={ev.key} ev={ev} onOpenSource={onOpenSource} />
            ))}
          </div>
        </details>
      ) : (
        finding.kind !== 'unknown' && <p className="finding__thin">没有对应到具体原话，依据有限。</p>
      )}

      {(rejectable || practicable) && (
        <div className="finding__actions">
          {practicable && (
            <button type="button" className="pill pill--warm" onClick={() => onPractice?.(finding.text)}>
              <Target aria-hidden="true" /> 练这个
            </button>
          )}
          {rejectable &&
            (confirming ? (
              <span className="inline-confirm" role="group" aria-label="确认不认同这条">
                <span className="small">标出来以后，用到它的卡片要重新整理。</span>
                <span className="row gap-s">
                  <button
                    type="button"
                    className="pill pill--warn"
                    onClick={() => {
                      setConfirming(false);
                      onReject?.(finding.id);
                    }}
                  >
                    对，我不认同
                  </button>
                  <button type="button" className="pill" onClick={() => setConfirming(false)}>
                    算了
                  </button>
                </span>
              </span>
            ) : (
              <button type="button" className="pill pill--plain" onClick={() => setConfirming(true)}>
                <CircleSlash aria-hidden="true" /> 我不这么看
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
  return (
    <div className="findings">
      {KIND_ORDER.map((kind) => {
        const group = findings.filter((f) => f.kind === kind);
        if (group.length === 0) return null;
        const Icon = KIND_ICON[kind];
        return (
          <section key={kind} className={`findings__group findings__group--${kind}`} aria-labelledby={`fk-${kind}`}>
            <h4 id={`fk-${kind}`} className="findings__title">
              <Icon aria-hidden="true" />
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
