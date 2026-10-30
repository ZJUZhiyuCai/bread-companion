'use client';

import { BookOpenCheck, Paperclip, Target } from 'lucide-react';
import type { Mode } from '@/domain/types';
import { MODE_META, MODE_ORDER } from './labels';

interface ModeBarProps {
  mode: Mode;
  canAct: boolean;
  busy: boolean;
  sourceCount: number;
  pendingSources: number;
  selectedQuestion: string;
  onMode: (m: Mode) => void;
  onStartReview: () => void;
  onAddSource: () => void;
  onOpenPractice: () => void;
}

export function ModeBar(props: ModeBarProps) {
  const { mode, canAct, busy, sourceCount, pendingSources, selectedQuestion, onMode, onStartReview, onAddSource, onOpenPractice } =
    props;

  return (
    <div className="modebar">
      <div className="modebar__chips" role="group" aria-label="今晚想做什么">
        {MODE_ORDER.map((m) => (
          <button
            key={m}
            type="button"
            className={`mode-chip mode-chip--${m} ${mode === m ? 'is-on' : ''}`}
            aria-pressed={mode === m}
            onClick={() => onMode(m)}
            disabled={!canAct}
          >
            <span className="mode-chip__notch" aria-hidden="true" />
            {MODE_META[m].label}
          </button>
        ))}
      </div>

      <div className="modebar__line">
        <p className="modebar__hint">{MODE_META[mode].hint}</p>

        {mode === 'review' && canAct && (
          <div className="modebar__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onAddSource}>
              <Paperclip aria-hidden="true" /> 放材料{sourceCount > 0 ? `（${sourceCount}）` : ''}
            </button>
            <button type="button" className="btn btn--quiet btn--sm" onClick={onStartReview} disabled={busy}>
              <BookOpenCheck aria-hidden="true" /> 开始复盘
            </button>
          </div>
        )}
        {mode === 'practice' && canAct && (
          <div className="modebar__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onOpenPractice}>
              <Target aria-hidden="true" /> {selectedQuestion ? '题目与维度' : '选一道题'}
            </button>
          </div>
        )}
      </div>
      {mode === 'review' && pendingSources > 0 && (
        <p className="modebar__note small">有 {pendingSources} 段材料还没确认归属，可以在“材料与依据”里确认。</p>
      )}
      {mode === 'review' && sourceCount === 0 && (
        <p className="modebar__note small">还没有材料也能开始，只是依据会很有限，结论里会标明。</p>
      )}
    </div>
  );
}
