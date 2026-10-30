'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, CircleCheck, Pencil, Plus, TriangleAlert } from 'lucide-react';
import type { Origin, Source } from '@/domain/types';
import { useDomId } from './hooks';
import { ORIGIN_META, ORIGIN_ORDER } from './labels';

interface AddSourceFormProps {
  maxChars: number | null;
  count: number;
  onAdd: (text: string, origin: Origin, label: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}

export function AddSourceForm({ maxChars, count, onAdd, onCancel, autoFocus }: AddSourceFormProps) {
  const [origin, setOrigin] = useState<Origin>('user_recollection');
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);
  const id = useDomId('src');
  const over = maxChars !== null && text.length > maxChars;

  useEffect(() => {
    if (autoFocus) textRef.current?.focus({ preventScroll: false });
  }, [autoFocus]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || over) return;
    onAdd(body, origin, label.trim() || `${ORIGIN_META[origin].label} ${count + 1}`);
    setText('');
    setLabel('');
  };

  return (
    <form className="source-form" onSubmit={submit} aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="source-form__title">
        放一段材料
      </h4>
      <p className="muted small">只粘贴你愿意讨论的片段就好，公司名和个人信息可以先删掉。</p>

      <fieldset className="origin-pick">
        <legend>这段是什么</legend>
        {ORIGIN_ORDER.map((o) => (
          <label key={o} className={`origin-pick__item ${origin === o ? 'is-on' : ''}`}>
            <input type="radio" name={`${id}-origin`} value={o} checked={origin === o} onChange={() => setOrigin(o)} />
            <span className="origin-pick__label">{ORIGIN_META[o].label}</span>
            <span className="origin-pick__desc">{ORIGIN_META[o].desc}</span>
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor={`${id}-label`}>给它起个名字（可选）</label>
        <input
          id={`${id}-label`}
          className="input"
          value={label}
          maxLength={40}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={ORIGIN_META[origin].example}
        />
      </div>

      <div className="field">
        <label htmlFor={`${id}-text`}>内容</label>
        <textarea
          id={`${id}-text`}
          ref={textRef}
          className="input textarea"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${id}-count`}
          aria-invalid={over || undefined}
        />
        <p id={`${id}-count`} className={`counter ${over ? 'is-over' : ''}`}>
          {maxChars !== null ? `${text.length} / ${maxChars} 字` : `${text.length} 字`}
          {over && '，超出上限了。可以截取最相关的一段，不会被自动截断。'}
        </p>
      </div>

      <div className="row gap-s">
        <button type="submit" className="btn btn--primary" disabled={!text.trim() || over}>
          <Plus aria-hidden="true" /> 放进材料
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

interface SourceItemProps {
  source: Source;
  canAct: boolean;
  highlighted: boolean;
  maxChars: number | null;
  onCorrect: (id: string, text: string) => void;
  onConfirm: (id: string) => void;
}

function SourceItem({ source, canAct, highlighted, maxChars, onCorrect, onConfirm }: SourceItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source.text);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const id = useDomId('srcitem');
  const long = source.text.length > 160;
  const over = maxChars !== null && draft.length > maxChars;

  useEffect(() => {
    if (!highlighted) return;
    ref.current?.scrollIntoView({ block: 'center' });
    ref.current?.focus({ preventScroll: true });
  }, [highlighted]);

  useEffect(() => {
    if (!editing) setDraft(source.text);
  }, [source.text, source.revision, editing]);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || over) return;
    if (body !== source.text) onCorrect(source.id, body);
    setEditing(false);
  };

  return (
    <li
      ref={ref}
      id={`source-${source.id}`}
      tabIndex={-1}
      className={`source source--${source.origin} ${highlighted ? 'is-highlighted' : ''}`}
    >
      <div className="source__head">
        <span className="source__origin">{ORIGIN_META[source.origin].label}</span>
        <h4 className="source__label">{source.label}</h4>
        <span className="source__rev">第 {source.revision} 版</span>
      </div>

      {editing ? (
        <form onSubmit={save} className="source__edit">
          <label htmlFor={`${id}-edit`} className="small">
            修正这段内容
          </label>
          <textarea
            id={`${id}-edit`}
            ref={editRef}
            className="input textarea"
            rows={6}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={`${id}-warn`}
          />
          <p id={`${id}-warn`} className="small warn-text">
            <TriangleAlert aria-hidden="true" /> 修正后会变成第 {source.revision + 1} 版，用到这段的分析和卡片会标为过期，需要重新确认。
            {over && ` 已超过 ${maxChars} 字上限。`}
          </p>
          <div className="row gap-s">
            <button type="submit" className="btn btn--primary btn--sm" disabled={!draft.trim() || over}>
              保存修正
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className={`source__text prewrap ${long && !expanded ? 'is-clamped' : ''}`}>{source.text}</p>
          {long && (
            <button
              type="button"
              className="link-btn small"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              <ChevronDown aria-hidden="true" className={expanded ? 'rot-180' : ''} />
              {expanded ? '收起' : '展开全文'}
            </button>
          )}
        </>
      )}

      {!editing && (
        <div className="source__foot">
          {source.confirmed ? (
            <span className="source__status is-ok">
              <CircleCheck aria-hidden="true" /> 已确认归属
            </span>
          ) : (
            <span className="source__status is-pending">
              <TriangleAlert aria-hidden="true" /> 待你确认：内容和“{ORIGIN_META[source.origin].label}”这个归属对吗？
            </span>
          )}
          {canAct && (
            <div className="row gap-s">
              {!source.confirmed && (
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => onConfirm(source.id)}>
                  <CircleCheck aria-hidden="true" /> 确认归属
                </button>
              )}
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> 修正
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

interface SourcesSectionProps {
  sources: Source[];
  canAct: boolean;
  maxChars: number | null;
  formOpen: boolean;
  setFormOpen: (v: boolean) => void;
  highlightId: string | null;
  onAdd: (text: string, origin: Origin, label: string) => void;
  onCorrect: (id: string, text: string) => void;
  onConfirm: (id: string) => void;
}

export function SourcesSection(props: SourcesSectionProps) {
  const { sources, canAct, maxChars, formOpen, setFormOpen, highlightId, onAdd, onCorrect, onConfirm } = props;
  const pending = sources.filter((s) => !s.confirmed).length;

  return (
    <div className="sources">
      {sources.length > 0 ? (
        <>
          {pending > 0 && (
            <p className="callout callout--pending">
              <TriangleAlert aria-hidden="true" /> 有 {pending} 段材料还没确认归属。确认的是“这段话属于哪类、内容对不对”，不是确认拒绝原因。
            </p>
          )}
          <ul className="sources__list">
            {sources.map((s) => (
              <SourceItem
                key={s.id}
                source={s}
                canAct={canAct}
                highlighted={highlightId === s.id}
                maxChars={maxChars}
                onCorrect={onCorrect}
                onConfirm={onConfirm}
              />
            ))}
          </ul>
        </>
      ) : (
        !formOpen && (
          <div className="empty-note">
            <p>还没有材料。</p>
            <p className="muted small">可以是你记得的回答、拒信原文或岗位描述片段。没有也完全可以，只是复盘时依据会更少。</p>
          </div>
        )
      )}

      {canAct &&
        (formOpen ? (
          <AddSourceForm
            maxChars={maxChars}
            count={sources.length}
            autoFocus
            onAdd={(t, o, l) => {
              onAdd(t, o, l);
              setFormOpen(false);
            }}
            onCancel={() => setFormOpen(false)}
          />
        ) : (
          <button type="button" className="btn btn--quiet btn--block" onClick={() => setFormOpen(true)}>
            <Plus aria-hidden="true" /> 放一段材料
          </button>
        ))}
    </div>
  );
}
