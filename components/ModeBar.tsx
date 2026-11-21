'use client';

import { BookmarkPlus, Briefcase, MessageCircle, ScanText, Shuffle, SlidersHorizontal, Target } from 'lucide-react';
import type { InterviewState, InterviewStyle } from '@/domain/types';
import { useDomId } from './hooks';
import { DOING_META, INTERVIEW_STYLE_LABEL, interviewRoundLabel } from './labels';
import type { AssistMode, BreadVM } from './vm';

interface ModeBarProps {
  vm: BreadVM;
  canAct: boolean;
  /** Offers appear only after the user has said something — never on a first, plain vent. */
  show: boolean;
  onAssist: (mode: AssistMode) => void;
  onBackToTalk: () => void;
  onAdjustPractice: () => void;
  onInterviewCall?: () => void;
}

const OFFERS: { mode: AssistMode; label: string; icon: typeof BookmarkPlus; hint: string }[] = [
  { mode: 'organize', label: '留个记号', icon: BookmarkPlus, hint: '用你说过的话起一张小签，你来改' },
  { mode: 'review', label: '看看那段回答', icon: ScanText, hint: '分开说清：你说过的、可能的解释、还不知道的' },
  { mode: 'practice', label: '练一题', icon: Target, hint: '面包挑一道题直接问你，答完给有出处的反馈' },
  { mode: 'interview', label: '模拟面试', icon: Briefcase, hint: '多轮追问模拟面试，支持温和陪练或真实深挖，练完生成有依据的复盘卡' },
];

/**
 * Modes are internal. What surfaces is one line about what's happening now (with a way back),
 * a ticket when practicing, and a few small invitations.
 */
export function ModeBar(props: ModeBarProps) {
  const { vm, canAct, show, onAssist, onBackToTalk, onAdjustPractice, onInterviewCall } = props;
  const { state: { mode, selectedQuestion, practiceCriteria, interview }, busy, currentCard } = vm;
  const hasCard = !!currentCard;
  const practicing = mode === 'practice' && !!selectedQuestion;
  const interviewing = mode === 'interview' && interview;
  const doing = DOING_META[mode];

  return (
    <div className="modebar">
      {interviewing ? (
        <InterviewTicket vm={vm} interview={interviewing} canAct={canAct} onCall={onInterviewCall} onExit={onBackToTalk} />
      ) : practicing ? (
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

      {show && canAct && !practicing && !interviewing && (
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

function InterviewTicket({ vm, interview, canAct, onCall, onExit }: {
  vm: BreadVM;
  interview: InterviewState;
  canAct: boolean;
  onCall?: () => void;
  onExit: () => void;
}) {
  const id = useDomId('interview-ticket');
  const debrief = interview.stage === 'debrief';
  const { busy } = vm;

  return (
    <section className="ticket ticket--interview" aria-labelledby={id}>
      <div className="ticket__main" tabIndex={0}>
        <p id={id} className="ticket__kicker">
          <Briefcase aria-hidden="true" /> 模拟面试 · {debrief ? '赛后复盘' : interviewRoundLabel(interview)} · {INTERVIEW_STYLE_LABEL[interview.style]}
        </p>
        {(!debrief || interview.currentQuestion) && <p className="ticket__q">{interview.currentQuestion || '正在准备问题…'}</p>}
        {interview.focusPoints.length > 0 && <p className="ticket__crit">留意 {interview.focusPoints.join('、')}</p>}
      </div>
      {canAct && (
        <div className="ticket__actions">
          <InterviewStyleToggle style={interview.style} onChange={vm.setInterviewStyle} disabled={busy || debrief} />
          <div className="ticket__interview-actions">
            <button type="button" className="pill pill--warm" disabled={busy} onClick={() => void (debrief ? vm.startInterview() : vm.requestInterviewDebrief())}>
              {debrief ? '再练一场' : '收尾复盘'}
            </button>
            {onCall && <button type="button" className="pill" disabled={busy} onClick={onCall}>改用电话练</button>}
            <button type="button" className="pill pill--plain" onClick={onExit}>回到只是聊聊</button>
          </div>
        </div>
      )}
    </section>
  );
}

export function InterviewStyleToggle({ style, onChange, disabled }: {
  style: InterviewStyle;
  onChange: (style: InterviewStyle) => void;
  disabled: boolean;
}) {
  return (
    <div className="interview-style" role="group" aria-label="面试风格">
      {(['gentle', 'realistic'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className="pill interview-style__choice"
          aria-pressed={style === value}
          disabled={disabled}
          onClick={() => { if (style !== value) onChange(value); }}
        >
          {INTERVIEW_STYLE_LABEL[value]}
        </button>
      ))}
    </div>
  );
}
