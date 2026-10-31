'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Braces, ChevronDown, FileDown, HardDrive, Lock, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import type { Card, Finding } from '@/domain/types';
import { EvidenceQuote } from './Evidence';
import { ValidityBadge } from './Findings';
import { useDomId } from './hooks';
import { CARD_TYPE_LABEL, KIND_META, VALIDITY_META, isLocked, sectionLabel, viewEvidence, type EvidenceContext } from './labels';

/** The paper itself: a kraft tag with a string for notes, a little bakery receipt for reviews. */
function PaperDecor({ type }: { type: Card['type'] }) {
  return type === 'note' ? (
    <>
      <span className="paper__hole" aria-hidden="true" />
      <svg className="paper__string" viewBox="0 0 60 40" aria-hidden="true" focusable="false">
        <path d="M6 30 C18 6 40 4 56 14" />
      </svg>
    </>
  ) : (
    <span className="paper__perf" aria-hidden="true" />
  );
}

function SavedTag() {
  return (
    <span className="tag tag--saved">
      <HardDrive aria-hidden="true" /> 已留在这台设备
    </span>
  );
}

interface CardViewProps {
  card: Card;
  findings: Finding[];
  ctx: EvidenceContext;
  readOnly?: boolean;
  busy?: boolean;
  saved?: boolean;
  onEdit?: (title: string, sections: Card['sections']) => void;
  onRequestSave?: () => void;
  onExport?: (format: 'md' | 'json') => void;
  onRedo?: () => void;
  onOpenSource?: (id: string) => void;
  /** Bump to open the editor from outside (e.g. “再改改” in the save preview). */
  editToken?: number;
  /** Called once the editor request has been handled, so a later remount doesn't reopen it. */
  onEditConsumed?: () => void;
}

export function CardView(props: CardViewProps) {
  const {
    card,
    findings,
    ctx,
    readOnly = false,
    busy = false,
    saved = false,
    onEdit,
    onRequestSave,
    onExport,
    onRedo,
    onOpenSource,
    editToken = 0,
    onEditConsumed,
  } = props;
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

  useEffect(() => {
    if (editToken === 0) return;
    if (!readOnly && !isLocked(card.validity)) setEditing(true);
    onEditConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editToken]);

  const byId = new Map(findings.map((f) => [f.id, f]));
  const locked = isLocked(card.validity);
  const canExport = !!onExport && (card.validity === 'confirmed' || saved || readOnly);
  const linkedProblem = card.sections.some((s) => s.findingIds.some((fid) => isLocked(byId.get(fid)?.validity ?? 'draft')));

  const submitEdit = (e: FormEvent) => {
    e.preventDefault();
    onEdit?.(title.trim() || card.title, sections);
    setEditing(false);
  };

  return (
    <article
      className={`paper paper--${card.type} is-${card.validity} ${readOnly ? 'is-readonly' : ''}`}
      aria-labelledby={editing ? undefined : `${id}-title`}
      aria-label={editing ? `修改${CARD_TYPE_LABEL[card.type]}` : undefined}
    >
      <PaperDecor type={card.type} />

      <header className="paper__head">
        <p className="paper__kicker">
          {CARD_TYPE_LABEL[card.type]}
          {card.revision > 1 && <span className="muted"> · 第 {card.revision} 版</span>}
        </p>
        {editing ? (
          <div className="field">
            <label htmlFor={`${id}-t`} className="field__label">
              标题
            </label>
            <input id={`${id}-t`} className="field-input field-input--title" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
          </div>
        ) : (
          <h3 id={`${id}-title`} className="paper__title">
            {card.title}
          </h3>
        )}
        <div className="paper__badges">
          {saved ? <SavedTag /> : <ValidityBadge validity={card.validity} />}
          {card.serviceMode === 'mock' && <span className="tag tag--mock">演示生成</span>}
          {readOnly && (
            <span className="tag">
              <Lock aria-hidden="true" /> 只读
            </span>
          )}
        </div>
      </header>

      {editing ? (
        <form className="paper__edit" onSubmit={submitEdit}>
          {sections.length === 0 && <p className="muted small">每一栏都删掉了，留下的话只有标题。</p>}
          {sections.map((s, i) => (
            <div className="field" key={`${s.key}-${i}`}>
              <div className="field__row">
                <label htmlFor={`${id}-s${i}`} className="field__label">
                  {sectionLabel(s.key)}
                </label>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => setSections((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`删掉“${sectionLabel(s.key)}”这一栏`}
                >
                  <Trash2 aria-hidden="true" /> 删掉这一栏
                </button>
              </div>
              <textarea
                id={`${id}-s${i}`}
                className="field-input"
                rows={3}
                value={s.text}
                onChange={(e) => {
                  const text = e.target.value;
                  setSections((prev) => prev.map((x, j) => (j === i ? { ...x, text } : x)));
                }}
              />
            </div>
          ))}
          <div className="row gap-s wrap">
            <button type="submit" className="btn btn--primary" disabled={busy}>
              改好了
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
              不改了
            </button>
          </div>
        </form>
      ) : (
        <dl className="paper__sections">
          {card.sections.length === 0 && <p className="muted small">这张卡片只有标题。</p>}
          {card.sections.map((s, i) => {
            const linked = s.findingIds.map((fid) => byId.get(fid)).filter((f): f is Finding => !!f);
            return (
              <div className="paper__section" key={`${s.key}-${i}`}>
                <dt className="paper__label">{sectionLabel(s.key)}</dt>
                <dd className="paper__text">
                  {s.text ? <span className="prewrap">{s.text}</span> : <span className="muted">（留空）</span>}
                  {linked.length > 0 && (
                    <details className="basis">
                      <summary>
                        <ChevronDown aria-hidden="true" className="basis__chev" />
                        依据 {linked.length} 条
                        {linked.some((f) => isLocked(f.validity)) && <span className="flag">其中有失效的</span>}
                      </summary>
                      <ul className="basis__body">
                        {linked.map((f) => (
                          <li key={f.id} className={`basis__item basis__item--${f.kind}`}>
                            <p className="basis__kind">
                              {KIND_META[f.kind].label}
                              {isLocked(f.validity) && <ValidityBadge validity={f.validity} />}
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
        <footer className="paper__foot">
          {locked && !readOnly && (
            <div className="callout callout--faded" role="note">
              <p>{VALIDITY_META[card.validity].desc}，这一版不再当作有效，也不能留下。</p>
              {onRedo && (
                <button type="button" className="btn btn--quiet btn--sm" onClick={onRedo} disabled={busy}>
                  <RotateCcw aria-hidden="true" /> 让面包重新整理
                </button>
              )}
            </div>
          )}
          {!locked && linkedProblem && !readOnly && <p className="callout small">有一条依据已经失效，留下之前再看一眼。</p>}

          {!readOnly && !locked && !saved && (
            <p className="paper__note">
              写得不像你想说的，就改改。这里确认的是写法，不是拒绝原因。
            </p>
          )}
          {readOnly && <p className="paper__note">这是结束时的那一版，不能再修改。要不要留下、导出，由你决定。</p>}

          <div className="paper__actions">
            {!locked && !saved && onRequestSave && (
              <button type="button" className="btn btn--primary" onClick={onRequestSave} disabled={busy && !readOnly}>
                <HardDrive aria-hidden="true" /> 留下这张…
              </button>
            )}
            {!readOnly && !locked && onEdit && (
              <button type="button" className="btn btn--ghost" onClick={() => setEditing(true)} disabled={busy}>
                <Pencil aria-hidden="true" /> 改改
              </button>
            )}
          </div>
          {canExport && (
            <div className="paper__export" role="group" aria-label="导出成文件">
              <span className="small muted">导出到这台设备：</span>
              <button type="button" className="text-btn" onClick={() => onExport?.('md')}>
                <FileDown aria-hidden="true" /> Markdown
              </button>
              <button type="button" className="text-btn" onClick={() => onExport?.('json')}>
                <Braces aria-hidden="true" /> JSON 备份
              </button>
            </div>
          )}
        </footer>
      )}
    </article>
  );
}

interface CardSlipProps {
  card: Card;
  saved: boolean;
  busy: boolean;
  canAct: boolean;
  onOpen: () => void;
  onSave: () => void;
  onRedo: () => void;
}

/** The card as it lands on the table, inside the conversation. The full card lives in the tray. */
export function CardSlip({ card, saved, busy, canAct, onOpen, onSave, onRedo }: CardSlipProps) {
  const id = useDomId('slip');
  const locked = isLocked(card.validity);
  const preview = card.sections.filter((s) => s.text.trim()).slice(0, 3);

  return (
    <section className={`paper paper--${card.type} paper--slip is-${card.validity}`} aria-labelledby={`${id}-t`}>
      <PaperDecor type={card.type} />
      <p className="paper__kicker">
        {CARD_TYPE_LABEL[card.type]}
        <span aria-hidden="true"> · </span>
        {saved ? '已留在这台设备' : VALIDITY_META[card.validity].label}
        {card.serviceMode === 'mock' && <span className="muted"> · 演示生成</span>}
      </p>
      <h2 id={`${id}-t`} className="paper__title">
        {card.title}
      </h2>
      {preview.length > 0 && (
        <dl className="slip-preview">
          {preview.map((s, i) => (
            <div key={`${s.key}-${i}`}>
              <dt>{sectionLabel(s.key)}</dt>
              <dd>{s.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {locked && <p className="slip-faded">{VALIDITY_META[card.validity].desc}，这一版先不算数了。</p>}
      <div className="paper__actions">
        {locked
          ? canAct && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={onRedo} disabled={busy}>
                <RotateCcw aria-hidden="true" /> 让面包重新整理
              </button>
            )
          : !saved &&
            canAct && (
              <button type="button" className="btn btn--primary btn--sm" onClick={onSave} disabled={busy}>
                <HardDrive aria-hidden="true" /> 留下这张…
              </button>
            )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen}>
          {locked || saved ? '看看' : '看看 / 改改'}
        </button>
      </div>
    </section>
  );
}
