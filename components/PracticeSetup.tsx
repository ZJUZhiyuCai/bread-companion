'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Target, X } from 'lucide-react';
import { useDomId } from './hooks';

const PRESET_CRITERIA = [
  '先给结论，再展开',
  '说清我具体做了什么',
  '有一个可核对的例子或数据',
  '讲清判断标准（比如通过条件、人工复核）',
  '坦白边界和还不知道的部分',
];

const MAX_CRITERIA = 2;

interface PracticeSetupProps {
  active: boolean;
  selectedQuestion: string;
  practiceCriteria: string[];
  suggestions: string[];
  prefill: string | null;
  canAct: boolean;
  busy: boolean;
  onStart: (question: string, criteria: string[]) => void;
  onAnswer: () => void;
}

export function PracticeSetup(props: PracticeSetupProps) {
  const { active, selectedQuestion, practiceCriteria, suggestions, prefill, canAct, busy, onStart, onAnswer } = props;
  const id = useDomId('practice');
  const [editing, setEditing] = useState(!active || !selectedQuestion);
  const [question, setQuestion] = useState(prefill ?? selectedQuestion);
  const [criteria, setCriteria] = useState<string[]>(practiceCriteria);
  const [custom, setCustom] = useState('');
  const [limitHit, setLimitHit] = useState(false);

  useEffect(() => {
    if (prefill) {
      setQuestion(prefill);
      setEditing(true);
    }
  }, [prefill]);

  useEffect(() => {
    if (active && selectedQuestion) setEditing(false);
  }, [active, selectedQuestion]);

  const toggle = (c: string) => {
    if (criteria.includes(c)) {
      setLimitHit(false);
      setCriteria(criteria.filter((x) => x !== c));
      return;
    }
    if (criteria.length >= MAX_CRITERIA) {
      setLimitHit(true);
      return;
    }
    setLimitHit(false);
    setCriteria([...criteria, c]);
  };

  const addCustom = () => {
    const c = custom.trim();
    if (!c) return;
    if (!criteria.includes(c)) toggle(c);
    setCustom('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || criteria.length === 0) return;
    onStart(q, criteria);
    setEditing(false);
  };

  const options = [...PRESET_CRITERIA, ...criteria.filter((c) => !PRESET_CRITERIA.includes(c))];

  if (!editing && active && selectedQuestion) {
    return (
      <div className="practice">
        <div className="practice-now">
          <p className="practice-now__kicker">
            <Target aria-hidden="true" /> 正在练这一道
          </p>
          <p className="practice-now__q">{selectedQuestion}</p>
          {practiceCriteria.length > 0 && (
            <ul className="crit-tags" aria-label="这次关注的维度">
              {practiceCriteria.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </div>
        <p className="small muted">
          在下方输入框写下（或录下）你的回答，发送后会得到有出处的反馈。只用你真实的经历，缺的部分会留空，不会帮你编。
        </p>
        {canAct && (
          <div className="row gap-s wrap">
            <button type="button" className="btn btn--primary" onClick={onAnswer} disabled={busy}>
              去回答 / 重答
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setEditing(true)} disabled={busy}>
              换一道题或改维度
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!canAct) return <p className="muted">会话已结束，不能再开始练习。</p>;

  return (
    <form className="practice" onSubmit={submit} aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="source-form__title">
        选一道题，练一次
      </h4>
      <p className="small muted">一次只练一道，一到两个维度。练完可以重答、换题，或者就此结束。</p>

      {suggestions.length > 0 && (
        <div className="suggest">
          <p className="small">复盘里提到的练习方向：</p>
          <ul className="suggest__list">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className={`chip ${question === s ? 'is-on' : ''}`}
                  aria-pressed={question === s}
                  onClick={() => setQuestion(s)}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="field">
        <label htmlFor={`${id}-q`}>题目</label>
        <textarea
          id={`${id}-q`}
          className="input textarea"
          rows={3}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="比如：你们的 Agent 用什么 benchmark 判断效果？通过条件是什么？"
        />
      </div>

      <fieldset className="crit-pick">
        <legend>
          这次关注什么 <span className="muted small">（选 1–2 个，已选 {criteria.length}）</span>
        </legend>
        <div className="crit-pick__grid">
          {options.map((c) => {
            const on = criteria.includes(c);
            return (
              <label key={c} className={`crit ${on ? 'is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(c)} />
                <span>{c}</span>
              </label>
            );
          })}
        </div>
        <p className="small warn-text" aria-live="polite">
          {limitHit ? '最多选两个，先取消一个再选。' : ''}
        </p>
        <div className="row gap-s">
          <label htmlFor={`${id}-c`} className="sr-only">
            自己写一个维度
          </label>
          <input
            id={`${id}-c`}
            className="input"
            value={custom}
            maxLength={40}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="自己写一个维度"
          />
          <button type="button" className="btn btn--ghost" onClick={addCustom} disabled={!custom.trim()}>
            <Plus aria-hidden="true" /> 加上
          </button>
        </div>
      </fieldset>

      <div className="row gap-s">
        <button type="submit" className="btn btn--primary" disabled={!question.trim() || criteria.length === 0 || busy}>
          <Target aria-hidden="true" /> 开始这道题
        </button>
        {active && selectedQuestion && (
          <button type="button" className="btn btn--ghost" onClick={() => setEditing(false)}>
            <X aria-hidden="true" /> 不换了
          </button>
        )}
      </div>
    </form>
  );
}
