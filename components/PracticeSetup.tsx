'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Shuffle } from 'lucide-react';
import { Dialog } from './Dialog';
import { useDomId } from './hooks';

const PRESET_CRITERIA = [
  '先给结论，再展开',
  '说清我具体做了什么',
  '有一个可核对的例子或数据',
  '讲清判断标准（比如通过条件、人工复核）',
  '坦白边界和还不知道的部分',
];

const MAX_CRITERIA = 2;

interface PracticeAdjustProps {
  open: boolean;
  onClose: () => void;
  question: string;
  criteria: string[];
  busy: boolean;
  onApply: (question: string, criteria: string[]) => void;
  onAnother: () => void;
}

/**
 * Optional. The agent already picked a question and one or two things to watch;
 * this is only for when the user wants it a little different.
 */
export function PracticeAdjust({ open, onClose, question, criteria, busy, onApply, onAnother }: PracticeAdjustProps) {
  const id = useDomId('practice');
  const [q, setQ] = useState(question);
  const [picked, setPicked] = useState<string[]>(criteria);
  const [custom, setCustom] = useState('');
  const [limitHit, setLimitHit] = useState(false);

  const criteriaKey = criteria.join('\u0000');
  useEffect(() => {
    if (!open) return;
    setQ(question);
    setPicked(criteria);
    setCustom('');
    setLimitHit(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, question, criteriaKey]);

  const toggle = (c: string) => {
    if (picked.includes(c)) {
      setLimitHit(false);
      setPicked(picked.filter((x) => x !== c));
      return;
    }
    if (picked.length >= MAX_CRITERIA) {
      setLimitHit(true);
      return;
    }
    setLimitHit(false);
    setPicked([...picked, c]);
  };

  const addCustom = () => {
    const c = custom.trim();
    if (!c) return;
    if (!picked.includes(c)) toggle(c);
    setCustom('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    onApply(text, picked);
  };

  const options = [...PRESET_CRITERIA, ...picked.filter((c) => !PRESET_CRITERIA.includes(c))];

  return (
    <Dialog open={open} onClose={onClose} title="调一调这道题" subtitle="不调也完全可以。面包已经挑好了题和要留意的地方。" size="md">
      <form className="adjust" onSubmit={submit}>
        <div className="field">
          <label htmlFor={`${id}-q`} className="field__label">
            题目
          </label>
          <textarea id={`${id}-q`} className="field-input" rows={3} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <fieldset className="crit-pick">
          <legend className="field__label">
            这次留意什么 <span className="muted small">（最多两个，不选就交给面包）</span>
          </legend>
          <div className="crit-pick__grid">
            {options.map((c) => {
              const on = picked.includes(c);
              return (
                <label key={c} className={`crit ${on ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c)} />
                  <span>{c}</span>
                </label>
              );
            })}
          </div>
          <p className="small warn-text" aria-live="polite">
            {limitHit ? '一次最多两个，先取消一个再选。' : ''}
          </p>
          <div className="row gap-s">
            <label htmlFor={`${id}-c`} className="sr-only">
              自己写一个
            </label>
            <input
              id={`${id}-c`}
              className="field-input"
              value={custom}
              maxLength={40}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="自己写一个"
            />
            <button type="button" className="btn btn--ghost" onClick={addCustom} disabled={!custom.trim()}>
              <Plus aria-hidden="true" /> 加上
            </button>
          </div>
        </fieldset>

        <div className="dialog__actions dialog__actions--inline">
          <button type="button" className="btn btn--ghost" onClick={onAnother} disabled={busy}>
            <Shuffle aria-hidden="true" /> 让面包换一题
          </button>
          <button type="submit" className="btn btn--primary" disabled={!q.trim() || busy}>
            就练这个
          </button>
        </div>
      </form>
    </Dialog>
  );
}
