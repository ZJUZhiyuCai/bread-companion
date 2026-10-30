'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Braces, ChevronDown, CircleCheck, FileDown, HardDrive, Lock, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { Card, Finding } from '@/domain/types';
import { EvidenceQuote } from './Evidence';
import { ValidityBadge } from './Findings';
import { useDomId } from './hooks';
import { CARD_TYPE_LABEL, KIND_META, VALIDITY_META, sectionLabel, viewEvidence, type EvidenceContext } from './labels';

interface CardViewProps {
  card: Card;
  findings: Finding[];
  ctx: EvidenceContext;
  readOnly?: boolean;
  busy?: boolean;
  onEdit?: (title: string, sections: Card['sections']) => void;
  onConfirm?: () => void;
  onRequestSave: () => void;
  onExport: (format: 'md' | 'json') => void;
  onRedo?: () => void;
  onOpenSource?: (id: string) => void;
}

function Scores() {
  return (
    <svg className="paper-card__scores" viewBox="0 0 120 14" aria-hidden="true" focusable="false">
      <path d="M8 11 q14 -12 30 -6" />
      <path d="M44 10 q14 -12 30 -6" />
      <path d="M80 11 q14 -12 30 -6" />
    </svg>
  );
}

export function CardView(props: CardViewProps) {
  const { card, findings, ctx, readOnly = false, busy = false, onEdit, onConfirm, onRequestSave, onExport, onRedo, onOpenSource } =
    props;
  const id = useDomId('card');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [sections, setSections] = useState(card.sections);

  // Reset drafts only when the card version changes, not on every parent re-render.
  useEffect(() => {
    setEditing(false);
    setTitle(card.title);
    setSections(card.sections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, card.revision, card.validity]);

  const byId = new Map(findings.map((f) => [f.id, f]));
  const locked = card.validity === 'stale' || card.validity === 'disputed';
  const confirmed = card.validity === 'confirmed';
  const linkedProblem = card.sections.some((s) =>
    s.findingIds.some((fid) => {
      const v = byId.get(fid)?.validity;
      return v === 'stale' || v === 'disputed';
    }),
  );

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    onEdit?.(title.trim() || card.title, sections);
    setEditing(false);
  };

  return (
    <article
      className={`paper-card paper-card--${card.type} is-${card.validity} ${readOnly ? 'is-readonly' : ''}`}
      aria-labelledby={editing ? undefined : `${id}-title`}
      aria-label={editing ? '修改卡片' : undefined}
    >
      <Scores />
      <span className="paper-card__hole" aria-hidden="true" />

      <header className="paper-card__head">
        <p className="paper-card__kicker">
          {CARD_TYPE_LABEL[card.type]}
          <span aria-hidden="true"> · </span>
          第 {card.revision} 版{card.parentRevision !== null && <span className="muted">（由第 {card.parentRevision} 版修改）</span>}
        </p>
        {editing ? (
          <div className="field">
            <label htmlFor={`${id}-t`} className="small">
              标题
            </label>
            <input
              id={`${id}-t`}
              className="input input--title"
              value={title}
              maxLength={60}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        ) : (
          <h3 id={`${id}-title`} className="paper-card__title">
            {card.title}
          </h3>
        )}
        <div className="paper-card__badges">
          <ValidityBadge validity={card.validity} />
          <span className={`svc-tag svc-tag--${card.serviceMode}`}>
            {card.serviceMode === 'mock' ? '规则演示生成' : 'AI 生成候选'}
          </span>
          {readOnly && (
            <span className="svc-tag">
              <Lock aria-hidden="true" /> 只读
            </span>
          )}
        </div>
        {confirmed && (
          <span className="stamp" aria-hidden="true">
            已确认
            <small>第 {card.revision} 版</small>
          </span>
        )}
      </header>

      {editing ? (
        <form className="paper-card__edit" onSubmit={submitEdit} aria-label="修改卡片">
          {sections.length === 0 && <p className="muted small">所有条目都删掉了。保存后卡片只保留标题。</p>}
          {sections.map((s, i) => (
            <div className="field field--section" key={`${s.key}-${i}`}>
              <div className="row between">
                <label htmlFor={`${id}-s${i}`}>{sectionLabel(s.key)}</label>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => setSections((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`删掉“${sectionLabel(s.key)}”这一条`}
                >
                  <Trash2 aria-hidden="true" /> 删掉这一条
                </button>
              </div>
              <textarea
                id={`${id}-s${i}`}
                className="input textarea"
                rows={3}
                value={s.text}
                onChange={(e) => {
                  const text = e.target.value;
                  setSections((prev) => prev.map((x, j) => (j === i ? { ...x, text } : x)));
                }}
              />
            </div>
          ))}
          <p className="small muted">改完会成为新的一版，需要你再确认一次。</p>
          <div className="row gap-s">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              保存修改
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setEditing(false);
                setTitle(card.title);
                setSections(card.sections);
              }}
            >
              取消
            </button>
          </div>
        </form>
      ) : (
        <dl className="paper-card__sections">
          {card.sections.length === 0 && <p className="muted small">这张卡片没有条目。</p>}
          {card.sections.map((s, i) => {
            const linked = s.findingIds.map((fid) => byId.get(fid)).filter((f): f is Finding => !!f);
            return (
              <div className="section" key={`${s.key}-${i}`}>
                <dt className="section__label">{sectionLabel(s.key)}</dt>
                <dd className="section__text">
                  {s.text ? <span className="prewrap">{s.text}</span> : <span className="muted">（留空）</span>}
                  {linked.length > 0 && (
                    <details className="section__basis">
                      <summary>
                        <ChevronDown aria-hidden="true" className="details-chevron" />
                        依据 {linked.length} 条
                        {linked.some((f) => f.validity === 'stale' || f.validity === 'disputed') && (
                          <span className="flag">其中有失效项</span>
                        )}
                      </summary>
                      <ul className="basis-list">
                        {linked.map((f) => (
                          <li key={f.id} className={`basis basis--${f.kind}`}>
                            <p className="basis__head">
                              <span className="basis__kind">{KIND_META[f.kind].label}</span>
                              {f.validity !== 'draft' && <ValidityBadge validity={f.validity} compact />}
                            </p>
                            <p className="basis__text">{f.text}</p>
                            {f.evidenceRefs.map((r) => {
                              const ev = viewEvidence(r, ctx);
                              return <EvidenceQuote key={ev.key} ev={ev} onOpenSource={onOpenSource} />;
                            })}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {!editing && (
        <footer className="paper-card__foot">
          {locked && !readOnly && (
            <div className="callout callout--locked" role="note">
              <p>
                <Lock aria-hidden="true" /> {VALIDITY_META[card.validity].desc}。这一版不能确认，也不能保存。
              </p>
              {onRedo && (
                <button type="button" className="btn btn--quiet btn--sm" onClick={onRedo} disabled={busy}>
                  <RotateCcw aria-hidden="true" /> 按修正后的内容重新整理
                </button>
              )}
            </div>
          )}
          {!locked && linkedProblem && !readOnly && (
            <p className="callout callout--pending small">有依据已失效，确认前请再看一眼对应条目。</p>
          )}

          {!readOnly && card.validity === 'draft' && (
            <p className="small muted">看看表述是不是你想说的。可以改字、删条目，再确认。确认的是表述，不等于确认拒绝原因。</p>
          )}
          {!readOnly && confirmed && (
            <p className="small muted">
              确认 ≠ 保存。想留着就点“保存到本设备…”，先看清会存什么；不保存的话，结束并关掉页面后它就会消失。
            </p>
          )}
          {readOnly && (
            <p className="small muted">这是结束时冻结的第 {card.revision} 版，不能再修改或生成。保存和导出由你决定。</p>
          )}

          <div className="paper-card__actions">
            {!readOnly && !confirmed && (
              <>
                <button type="button" className="btn btn--ghost" onClick={() => setEditing(true)} disabled={busy || locked}>
                  <Pencil aria-hidden="true" /> 改字 / 删条目
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={onConfirm}
                  disabled={busy || locked}
                  aria-describedby={locked ? undefined : `${id}-cf`}
                >
                  <CircleCheck aria-hidden="true" /> 这样表述没问题，确认这一版
                </button>
                <span id={`${id}-cf`} className="sr-only">
                  确认后还需要另外点击保存，才会存到本设备。
                </span>
              </>
            )}
            {confirmed && (
              <>
                <button type="button" className="btn btn--primary" onClick={onRequestSave}>
                  <HardDrive aria-hidden="true" /> 保存到本设备…
                </button>
                <div className="export-group" role="group" aria-label="导出到文件">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => onExport('md')}>
                    <FileDown aria-hidden="true" /> 导出 Markdown
                  </button>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => onExport('json')}>
                    <Braces aria-hidden="true" /> 导出 JSON 备份
                  </button>
                </div>
                {!readOnly && (
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(true)} disabled={busy}>
                    <Pencil aria-hidden="true" /> 再改改（会生成新版本）
                  </button>
                )}
              </>
            )}
          </div>
          {confirmed && <p className="small muted">导出的文件下载到这台设备，不会发送到任何地方。</p>}
        </footer>
      )}
    </article>
  );
}
