'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, CircleCheck, Paperclip, Pencil, Plus, TriangleAlert } from 'lucide-react';
import type { Source } from '@/domain/types';
import { Dialog } from './Dialog';
import { useAutoGrow, useDomId } from './hooks';
import { ORIGIN_META } from './labels';

interface MaterialDialogProps {
  open: boolean;
  onClose: () => void;
  prefill: string;
  error?: string;
  maxChars: number | null;
  canAct: boolean;
  onAdd: (text: string) => void;
}

/** One box. No categories, no names, no extra confirmation: what you paste is what you gave. */
export function MaterialDialog({ open, onClose, prefill, maxChars, canAct, onAdd, error }: MaterialDialogProps) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useDomId('mat');
  const over = maxChars !== null && text.length > maxChars;

  useEffect(() => {
    if (!open) return;
    setText(prefill);
    const t = window.setTimeout(() => ref.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open, prefill]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || over || !canAct) return;
    onAdd(body);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="放一段材料"
      subtitle="拒信原文、你记得的回答、岗位描述……粘贴就好，只放你愿意聊的那部分。"
      size="md"
      className="material"
    >
      <form onSubmit={submit} className="material__form">
        <label htmlFor={`${id}-t`} className="sr-only">
          材料内容
        </label>
        <textarea
          id={`${id}-t`}
          ref={ref}
          className="material__input"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-describedby={`${id}-n`}
          aria-invalid={over || undefined}
          placeholder="比如：感谢你参加我们的面试。经过慎重考虑，我们认为你与该岗位暂不匹配……"
        />
        <p id={`${id}-n`} className={`small ${over ? 'warn-text' : 'muted'}`}>
          {over
            ? `${text.length} / ${maxChars} 字，超出上限了。截取最相关的一段就好，面包不会替你截断。`
            : '它会被记为“你放进来的材料”：确实是你提交的文字，但不代表里面说的都已核实。公司名、个人信息可以先删掉。'}
        </p>
        {error && <p className="warn-text" role="alert">{error}</p>}
        <div className="material__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            先不放
          </button>
          <button type="submit" className="btn btn--primary" disabled={!text.trim() || over || !canAct}>
            <Paperclip aria-hidden="true" /> 放进来
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface SourceSlipProps {
  source: Source;
  canAct: boolean;
  highlighted: boolean;
  maxChars: number | null;
  onCorrect: (id: string, text: string) => void;
  onConfirm: (id: string) => void;
}

function SourceSlip({ source, canAct, highlighted, maxChars, onCorrect, onConfirm }: SourceSlipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source.text);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const id = useDomId('srcitem');
  const long = source.text.length > 180;
  const over = maxChars !== null && draft.length > maxChars;
  useAutoGrow(editRef, editing ? draft : '', 320);

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
      className={`slip slip--${source.origin} ${highlighted ? 'is-highlighted' : ''}`}
      aria-labelledby={`${id}-h`}
    >
      <div className="slip__head">
        <h4 id={`${id}-h`} className="slip__label">
          {source.label || ORIGIN_META[source.origin].label}
        </h4>
        <span className="slip__meta">
          {ORIGIN_META[source.origin].label}
          {source.revision > 1 && ` · 改过 ${source.revision - 1} 次`}
        </span>
      </div>

      {editing ? (
        <form onSubmit={save} className="slip__edit">
          <label htmlFor={`${id}-edit`} className="small">
            改成你记得的样子
          </label>
          <textarea
            id={`${id}-edit`}
            ref={editRef}
            className="field-input"
            rows={4}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-describedby={`${id}-warn`}
          />
          <p id={`${id}-warn`} className="small warn-text">
            <TriangleAlert aria-hidden="true" /> 改了之后，用到这段的卡片和看法会标成“需要重新整理”，旧的不会再当作有效。
            {over && ` 已超过 ${maxChars} 字。`}
          </p>
          <div className="row gap-s">
            <button type="submit" className="btn btn--primary btn--sm" disabled={!draft.trim() || over}>
              就这样改
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(false)}>
              不改了
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className={`slip__text prewrap ${long && !expanded ? 'is-clamped' : ''}`}>{source.text}</p>
          {long && (
            <button type="button" className="text-btn" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
              <ChevronDown aria-hidden="true" className={expanded ? 'rot-180' : ''} />
              {expanded ? '收起' : '展开全文'}
            </button>
          )}
        </>
      )}

      {!editing && (
        <div className="slip__foot">
          {!source.confirmed && (
            <p className="slip__pending">
              <TriangleAlert aria-hidden="true" /> 这段还没经你确认，内容还对吗？
            </p>
          )}
          {canAct && (
            <div className="row gap-s wrap">
              {!source.confirmed && (
                <button type="button" className="pill pill--warm" onClick={() => onConfirm(source.id)}>
                  <CircleCheck aria-hidden="true" /> 对，是这样
                </button>
              )}
              <button type="button" className="pill" onClick={() => setEditing(true)}>
                <Pencil aria-hidden="true" /> 改一改
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
  highlightId: string | null;
  onAdd: () => void;
  onCorrect: (id: string, text: string) => void;
  onConfirm: (id: string) => void;
}

export function SourcesSection({ sources, canAct, maxChars, highlightId, onAdd, onCorrect, onConfirm }: SourcesSectionProps) {
  return (
    <div className="sources">
      {sources.length > 0 ? (
        <ul className="sources__list">
          {sources.map((s) => (
            <SourceSlip
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
      ) : (
        <p className="tray-empty">
          还没有材料。没有也完全可以；放进来的话，面包引用时会照原文，不改一个字。
        </p>
      )}
      {canAct && (
        <button type="button" className="btn btn--quiet btn--block" onClick={onAdd}>
          <Plus aria-hidden="true" /> 放一段材料
        </button>
      )}
    </div>
  );
}
