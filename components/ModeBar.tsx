'use client';

import { BookmarkPlus, MessageCircle, ScanText, Shuffle, SlidersHorizontal, Target } from 'lucide-react';
import type { Mode } from '@/domain/types';
import { DOING_META } from './labels';
import type { AssistMode } from './vm';

interface ModeBarProps {
  mode: Mode;
  selectedQuestion: string;
  practiceCriteria: string[];
  canAct: boolean;
  busy: boolean;
  /** Offers appear only after the user has said something — never on a first, plain vent. */
  show: boolean;
  hasCard: boolean;
  onAssist: (mode: AssistMode) => void;
  onBackToTalk: () => void;
  onAdjustPractice: () => void;
}

const OFFERS: { mode: AssistMode; label: string; icon: typeof BookmarkPlus; hint: string }[] = [
  { mode: 'organize', label: '留个记号', icon: BookmarkPlus, hint: '用你说过的话起一张小签，你来改' },
  { mode: 'review', label: '看看那段回答', icon: ScanText, hint: '分开说清：你说过的、可能的解释、还不知道的' },
  { mode: 'practice', label: '练一题', icon: Target, hint: '面包挑一道题直接问你，答完给有出处的反馈' },
];

/**
 * Modes are internal. What surfaces is one line about what's happening now (with a way back),
 * a ticket when practicing, and three small invitations.
 */
export function ModeBar(props: ModeBarProps) {
  const { mode, selectedQuestion, practiceCriteria, canAct, busy, show, hasCard, onAssist, onBackToTalk, onAdjustPractice } = props;
  const practicing = mode === 'practice' && !!selectedQuestion;
  const doing = DOING_META[mode];

  return (
    <div className="modebar">
      {practicing ? (
        <section className="ticket" aria-labelledby="ticket-k">
          <div className="ticket__main">
            <p id="ticket-k" className="ticket__kicker">
              <Target aria-hidden="true" /> 在练这一题
            </p>
            <p className="ticket__q">{selectedQuestion}</p>
            {practiceCriteria.length > 0 && <p className="ticket__crit">这次留意：{practiceCriteria.join('、')}</p>}
          </div>
          {canAct && (
            <div className="ticket__actions">
              <button type="button" className="pill" onClick={() => onAssist('practice')} disabled={busy}>
                <Shuffle aria-hidden="true" /> 换一题
              </button>
              <button type="button" className="pill" onClick={onAdjustPractice} disabled={busy}>
                <SlidersHorizontal aria-hidden="true" /> 调一调
              </button>
              <button type="button" className="pill" onClick={onBackToTalk} disabled={busy}>
                <MessageCircle aria-hidden="true" /> 不练了
              </button>
            </div>
          )}
        </section>
      ) : (
        doing && (
          <p className="doing">
            <span className="doing__dot" aria-hidden="true" />
            <span>{doing}</span>
            {canAct && (
              <button type="button" className="doing__back" onClick={onBackToTalk} disabled={busy}>
                回到只是聊聊
              </button>
            )}
          </p>
        )
      )}

      {show && canAct && !practicing && (
        <div className="offers" role="group" aria-labelledby="offers-lead">
          <span id="offers-lead" className="offers__lead">
            想的话，也可以
          </span>
          {OFFERS.filter((o) => o.mode !== mode || (o.mode === 'organize' && hasCard)).map((o) => {
            const Icon = o.icon;
            const label = o.mode === 'organize' && hasCard ? '再整理一次记号' : o.label;
            return (
              <button
                key={o.mode}
                type="button"
                className="offer"
                onClick={() => onAssist(o.mode)}
                disabled={busy}
                title={o.hint}
                aria-describedby={`offer-${o.mode}`}
              >
                <Icon aria-hidden="true" />
                {label}
              </button>
            );
          })}
          <span className="sr-only">
            {OFFERS.map((o) => (
              <span key={o.mode} id={`offer-${o.mode}`}>
                {o.hint}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
