'use client';

import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { Check, Hand, LoaderCircle, Mic, MicOff, Phone, PhoneOff, RotateCcw, TriangleAlert } from 'lucide-react';
import type { CallPhase, Card, InterviewState, Message } from '@/domain/types';
import { CallStage } from './CallStage';
import { InterviewStyleToggle } from './ModeBar';
import { CALL_RUNNING, IDLE_CALL, callMeta } from './call';
import { useAfterimage, useDomId } from './hooks';
import { INTERVIEW_STYLE_LABEL, formatClock, interviewRoundLabel, isLocked, sectionLabel } from './labels';
import type { BreadVM } from './vm';

interface CallRoomProps {
  vm: BreadVM;
  /** Wide screens keep the transcript open beside the call. */
  wide: boolean;
  debriefCard: Card | null;
  onHangup: () => void;
  onOpenDebriefCard: () => void;
}

interface PrimaryKey {
  label: string;
  icon: ReactNode;
  onPress?: () => void;
  tone: 'go' | 'soft' | 'wait';
}

type MobileView = 'captions' | 'interview' | 'log';

/** Phases 面包's own voice can be cut off from: speaking up here stops it and keeps the new sentence. */
const CUTTABLE: CallPhase[] = ['transcribing', 'thinking', 'speaking'];

/** Phases in which the person is simply waiting for 面包 to answer. They share one heading. */
const WAITING: CallPhase[] = ['transcribing', 'thinking'];
/**
 * On a phone, a silence past two or three seconds starts to feel like the line has gone. Most turns are
 * answered well before this; the long tail isn't. Past it, one quiet line says the true thing — still
 * thinking — and goes the moment the phase does. It promises nothing about when.
 */
const LONG_WAIT_MS = 2600;

/**
 * The voice call. The lights go down, the red phone on 面包's table is dialled and rings, and the
 * handset comes up to 面包's cheek only when the line is really open. One key in the middle always does
 * the single most useful thing for the current phase. Hang up keeps the text; nothing is faked.
 *
 * Speaking up now interrupts on its own, so this room explains nothing and acknowledges instead:
 * when 面包 gets cut off, its line visibly recedes and the light behind it comes up to listen.
 *
 * The words are set like film subtitles: 面包's line large and centred, yours small and pale above it.
 * Who said which stays in the markup for screen readers; on screen the type itself tells them apart.
 */
export function CallRoom({ vm, wide, debriefCard, onHangup, onOpenDebriefCard }: CallRoomProps) {
  const call = vm.call ?? IDLE_CALL;
  const { phase } = call;
  const { mode, messages } = vm.state;
  const interview = mode === 'interview' ? vm.state.interview : null;
  const inInterview = interview !== null;
  const meta = callMeta(call, mode);
  const id = useDomId('callroom');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const interviewToggleRef = useRef<HTMLButtonElement>(null);
  const interviewPanelRef = useRef<HTMLElement>(null);
  const [mobileView, setMobileView] = useState<MobileView>('captions');
  const [announce, setAnnounce] = useState('');
  // 面包 was just cut off mid-sentence; shown for a beat, without words.
  const [caught, setCaught] = useState(false);
  // Said once per call, the first time 面包 speaks. Never repeated.
  const [cue, setCue] = useState(false);
  const cueSpent = useRef(false);
  const prevPhase = useRef(phase);
  const cutAt = useRef(0);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!inInterview) setMobileView((view) => view === 'interview' ? 'captions' : view);
  }, [inInterview]);

  useEffect(() => {
    if (!wide && mobileView === 'interview') interviewPanelRef.current?.focus({ preventScroll: true });
  }, [wide, mobileView]);

  // One quiet line per phase. The reply itself is heard, so captions are not read out a second time.
  useEffect(() => {
    const from = prevPhase.current;
    prevPhase.current = phase;
    // Back to listening out of a reply: possibly an interruption. Confirmed below, by heardSpeech.
    if (phase === 'listening' && CUTTABLE.includes(from)) cutAt.current = Date.now();
    if (phase !== 'idle' && phase !== 'error') setAnnounce(meta.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // A normal finished turn also lands on listening, so an interruption is only claimed once speech
  // has actually been heard right after the cut. Without that signal, nothing is shown.
  useEffect(() => {
    if (phase !== 'listening' || !call.heardSpeech || !cutAt.current || Date.now() - cutAt.current > 700) return;
    cutAt.current = 0;
    setCaught(true);
    setCue(false);
    setAnnounce('停下来了，在听你说');
  }, [phase, call.heardSpeech]);

  useEffect(() => {
    if (phase !== 'speaking' || cueSpent.current) return;
    cueSpent.current = true;
    setCue(true);
  }, [phase]);

  // Each transient owns its own lifetime. Tied to phase instead, the next phase change would clear
  // the timeout while leaving the state on — a cut-off look or a cue that never goes away.
  useEffect(() => {
    if (!caught) return;
    const t = window.setTimeout(() => setCaught(false), 1100);
    return () => window.clearTimeout(t);
  }, [caught]);

  useEffect(() => {
    if (!cue) return;
    const t = window.setTimeout(() => setCue(false), 5200);
    return () => window.clearTimeout(t);
  }, [cue]);

  // One continuous wait (transcribing then thinking counts as one), timed from when it really began.
  const waiting = WAITING.includes(phase);
  const [longWait, setLongWait] = useState(false);
  useEffect(() => {
    setLongWait(false);
    if (!waiting) return;
    const t = window.setTimeout(() => setLongWait(true), LONG_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [waiting]);

  // The heading's previous words give way to the new ones in place, instead of a blank frame between.
  const wasTitle = useAfterimage(meta.title, meta.title);

  const running = CALL_RUNNING.includes(phase);
  const canMute = call.active && running && phase !== 'connecting';
  const canStartInterview = mode === 'listen' && canMute;
  const compactView = wide || (!interview && mobileView === 'interview') ? 'captions' : mobileView;
  const question = interview?.currentQuestion || '正在准备这一题…';
  const debrief = interview?.stage === 'debrief';

  const focusCaptions = () => {
    setMobileView('captions');
    headingRef.current?.focus({ preventScroll: true });
  };
  const startInterview = () => {
    focusCaptions();
    void vm.startInterview();
  };

  const interviewPanelId = `${id}-interview`;
  const interviewPanel = interview && (
    <CallInterviewPanel
      id={interviewPanelId}
      vm={vm}
      interview={interview}
      question={question}
      canControl={canMute}
      compact={!wide}
      panelRef={interviewPanelRef}
      debriefCard={debriefCard}
      onOpenDebriefCard={onOpenDebriefCard}
      onExit={() => {
        focusCaptions();
        vm.exitInterviewToListen();
      }}
    />
  );

  // 插话 stays in the middle slot, keyboard-reachable, same size as always — but quiet now. It is the
  // way round a noisy room or a hands-free moment, not the way to interrupt.
  const primary: PrimaryKey = (() => {
    switch (phase) {
      case 'listening':
        return call.heardSpeech
          ? { label: '说完了', icon: <Check aria-hidden="true" />, onPress: vm.finishCallTurn, tone: 'go' }
          : { label: '说完了', icon: <Check aria-hidden="true" />, tone: 'wait' };
      case 'transcribing':
      case 'thinking':
      case 'speaking':
        return { label: '插话', icon: <Hand aria-hidden="true" />, onPress: vm.interruptCall, tone: 'soft' };
      case 'muted':
        return { label: '打开麦克风', icon: <Mic aria-hidden="true" />, onPress: vm.toggleCallMute, tone: 'go' };
      case 'paused':
        return { label: '继续通话', icon: <Phone aria-hidden="true" />, onPress: () => void vm.resumeCall(), tone: 'go' };
      case 'error':
        return { label: '再试一次', icon: <RotateCcw aria-hidden="true" />, onPress: () => void vm.resumeCall(), tone: 'go' };
      default:
        return { label: '接通中', icon: <LoaderCircle aria-hidden="true" className="spin" />, tone: 'wait' };
    }
  })();

  const level = phase === 'listening' && !call.muted ? Math.max(0, Math.min(1, call.level || 0)) : 0;

  return (
    <section
      className={`callroom ${wide ? 'callroom--wide' : ''} ${compactView === 'log' ? 'is-log' : ''} ${caught ? 'is-caught' : ''}`}
      data-phase={phase}
      aria-labelledby={`${id}-h`}
    >
      <div className="callroom__main">
        <header className="callroom__bar">
          {/* One label that stays true in every phase; which phase it is belongs to the heading below. */}
          <p className="callroom__live">
            <span className="callroom__pulse" aria-hidden="true" />
            语音通话
            <time className="callroom__time" dateTime={`PT${Math.floor(call.elapsedSeconds)}S`}>
              {formatClock(call.elapsedSeconds)}
            </time>
          </p>
          {interview && (
            <p className="callroom__mode-pill">
              {debrief ? '模拟复盘' : `模拟面试 · ${interviewRoundLabel(interview)}`}
            </p>
          )}
        </header>

        <CallStage call={call} level={level} className="callroom__stage" />

        <div className="callroom__status">
          {/* The words change inside a heading that stays put, so focus never drops when a phase does.
              The words it just had fade out on top of it, outside the heading and hidden from readers. */}
          <div className="callroom__phase-wrap">
            <h2 id={`${id}-h`} ref={headingRef} tabIndex={-1} className="callroom__phase">
              <span key={meta.title} className="callroom__phase-text">
                {meta.title}
              </span>
            </h2>
            {wasTitle && (
              <p key={wasTitle.n} className="callroom__phase-ghost" aria-hidden="true">
                {wasTitle.value}
              </p>
            )}
          </div>
          {(meta.hint || (phase === 'paused' && call.error)) && (
            <p className="callroom__hint">{phase === 'paused' && call.error ? call.error : meta.hint}</p>
          )}
          {['listening', 'muted'].includes(phase) && call.inputWarning && <p className="callroom__hint" role="status">{call.inputWarning}</p>}
          {/* Only while there is something to interrupt; muted or paused, the line would be wrong. */}
          {cue && CUTTABLE.includes(phase) && <p className="callroom__cue">想说就直接开口，也可以点“插话”</p>}
          {phase === 'error' && call.error && (
            <p className="callroom__error" role="alert">
              <TriangleAlert aria-hidden="true" />
              <span>{call.error}</span>
            </p>
          )}
        </div>

        {compactView === 'log' ? (
          <CallLog messages={messages} compact />
        ) : compactView === 'interview' ? (
          interviewPanel
        ) : (
          <div className="callroom__captions" tabIndex={0}>
            {!wide && interview && !debrief && <p className="callroom__question-hint">本轮题目 · {question}</p>}
            {/* A new line is a new subtitle and comes up as one; a line that grows keeps its place. */}
            {call.lastHeard && (
              <p key={lineKey(call.lastHeard)} className="cap cap--you">
                <span className="cap__who">你</span>
                <span className="cap__text">{call.lastHeard}</span>
              </p>
            )}
            {call.caption ? (
              // Cut off while speaking, the backend keeps the caption: the line recedes instead of
              // vanishing, so it reads as interrupted. Cut off while thinking, there is no line — the light says it.
              <p
                key={lineKey(call.caption)}
                className={`cap cap--bread ${phase === 'speaking' ? 'is-live' : ''} ${caught ? 'is-cut' : ''} ${call.captionPreview ? 'is-preview' : ''}`}
              >
                <span className="cap__who">面包</span>
                <span className="cap__text">{call.caption}</span>
              </p>
            ) : (
              // Only once the line is open; while it is still ringing there is nothing to answer yet.
              !interview && !call.lastHeard && phase === 'listening' && <p className="cap cap--empty">开个头就好，比如“今天有点累”。</p>
            )}
            {/* Last in the captions, so it never moves the words already there; the keys stay at the foot.
                A note, like the heading, in 面包's words — but set small and plain, never in the subtitle
                hand: nothing was said aloud, and a subtitle would claim it was. */}
            {longWait && waiting && <p className="callroom__wait">还在想，再等我一下。</p>}
          </div>
        )}

        <div className="callroom__controls" role="group" aria-label="通话控制">
          <CallKey
            label={call.muted ? '已静音' : '静音'}
            ariaLabel="静音"
            pressed={call.muted}
            disabled={!canMute}
            onPress={vm.toggleCallMute}
            className="callkey--mute"
          >
            {call.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
          </CallKey>
          <CallKey
            label={primary.label}
            disabled={!primary.onPress}
            onPress={primary.onPress}
            className={`callkey--primary callkey--${primary.tone}`}
          >
            {primary.icon}
          </CallKey>
          <CallKey label="挂断" onPress={onHangup} className="callkey--hangup">
            <PhoneOff aria-hidden="true" />
          </CallKey>
        </div>

        <div className="callroom__more">
          {running && phase !== 'connecting' && (
            <button type="button" className="callroom__link" onClick={vm.stop} aria-keyshortcuts="Escape">
              暂停
            </button>
          )}
          {!wide && canStartInterview && (
            <button type="button" className="callroom__link callroom__link--interview" onClick={startInterview}>
              开始语音模拟面试
            </button>
          )}
          {!wide && interview && (
            <button
              type="button"
              ref={interviewToggleRef}
              className="callroom__link callroom__link--interview"
              onClick={() => {
                if (compactView === 'interview') {
                  setMobileView('captions');
                  interviewToggleRef.current?.focus({ preventScroll: true });
                } else setMobileView('interview');
              }}
              aria-expanded={compactView === 'interview'}
              aria-controls={compactView === 'interview' ? interviewPanelId : undefined}
            >
              {compactView === 'interview' ? '回到字幕' : '面试题卡'}
            </button>
          )}
          {!wide && (
            <button
              type="button"
              className="callroom__link"
              onClick={() => setMobileView((view) => view === 'log' ? 'captions' : 'log')}
              aria-expanded={compactView === 'log'}
            >
              {compactView === 'log' ? '回到字幕' : `文字记录${messages.length ? `（${messages.length}）` : ''}`}
            </button>
          )}
          {phase === 'listening' && !call.heardSpeech && (
            <button type="button" className="callroom__link" onClick={() => { vm.stop(); void vm.resumeCall(); }}>
              重新连接麦克风
            </button>
          )}
          <button type="button" className="callroom__link" onClick={onHangup}>
            挂断，改成打字
          </button>
        </div>
      </div>

      {wide && (
        <aside className="callroom__side">
          {canStartInterview && (
            <div className="call-bridge">
              <p>缓过来了的话，也可以顺手练一段</p>
              <button type="button" className="pill pill--warm" onClick={startInterview}>开始语音模拟面试</button>
            </div>
          )}
          {interviewPanel}
          <CallLog messages={messages} />
        </aside>
      )}

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  );
}

interface CallInterviewPanelProps {
  id: string;
  vm: BreadVM;
  interview: InterviewState;
  question: string;
  canControl: boolean;
  compact: boolean;
  panelRef: Ref<HTMLElement>;
  debriefCard: Card | null;
  onOpenDebriefCard: () => void;
  onExit: () => void;
}

function CallInterviewPanel({ id, vm, interview, question, canControl, compact, panelRef, debriefCard, onOpenDebriefCard, onExit }: CallInterviewPanelProps) {
  const debrief = interview.stage === 'debrief';
  const canAdvance = canControl && !(debrief && vm.busy);
  const cardLocked = !!debriefCard && isLocked(debriefCard.validity);
  return (
    <section id={id} ref={panelRef} className={`call-interview${compact ? ' call-interview--compact' : ''}`} aria-labelledby={`${id}-status`} tabIndex={0}>
      <h3 id={`${id}-status`} className="call-interview__status">
        {interviewRoundLabel(interview)} · {debrief ? '赛后复盘' : INTERVIEW_STYLE_LABEL[interview.style]}
      </h3>
      <InterviewStyleToggle style={interview.style} onChange={vm.setInterviewStyle} disabled={!canControl || vm.call.phase === 'transcribing' || debrief || interview.stage === 'opening'} />
      {!debrief && (
        <div className="call-interview__prompt">
          <p className="call-interview__question">{question}</p>
          {interview.focusPoints.length > 0 && (
            <p className="call-interview__focus">
              <span>留意</span>
              {interview.focusPoints.map((point, index) => <span key={index} className="call-interview__tag">{point}</span>)}
            </p>
          )}
        </div>
      )}
      {interview.notes.length > 0 && (
        <details className="call-interview__notes">
          <summary>最近的答题记录</summary>
          <ul>
            {interview.notes.slice(-2).reverse().map((note, index) => (
              <li key={`${note.round}-${index}`}>
                <strong>第 {note.round} 轮</strong>
                {note.strength && <p>{note.strength}</p>}
                {note.gap && <p>{note.gap}</p>}
                {!note.strength && !note.gap && <p>{note.question}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {cardLocked && <p className="call-interview__card">引用的材料或判断已改动，这张复盘卡需要重新整理。</p>}
      {debriefCard && !cardLocked && (
        <div className="call-interview__card">
          <h4>{debriefCard.title}</h4>
          <dl>
            {debriefCard.sections.slice(0, 3).map((section, index) => (
              <div key={index}>
                <dt>{sectionLabel(section.key)}</dt>
                <dd>{section.text}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className="pill pill--warm" onClick={onOpenDebriefCard} aria-describedby={`${id}-debrief-action`}>
            查看并保存复盘卡
          </button>
          <span className="sr-only" id={`${id}-debrief-action`}>打开复盘卡会结束这通电话。</span>
        </div>
      )}
      <div className="call-interview__actions">
        {debrief && (!debriefCard || cardLocked) && (
          <button type="button" className="pill pill--warm" aria-disabled={!canAdvance || undefined} onClick={() => {
            if (canAdvance) void vm.requestInterviewDebrief();
          }}>
            {cardLocked ? '重新复盘' : '重试复盘'}
          </button>
        )}
        <button
          type="button"
          className="pill pill--warm"
          aria-disabled={!canAdvance || undefined}
          onClick={() => {
            if (canAdvance) void (debrief ? vm.startInterview() : vm.requestInterviewDebrief());
          }}
        >
          {debrief ? '再练一场' : '收尾复盘'}
        </button>
        <button type="button" className="pill pill--plain" onClick={onExit}>回到聊聊</button>
      </div>
    </section>
  );
}

interface CallKeyProps {
  label: string;
  ariaLabel?: string;
  pressed?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Which subtitle a line belongs to: its opening characters. A caption that grows as it is spoken keeps
 * its key (and its place); a different sentence gets a new one, so it comes up as a new subtitle.
 */
function lineKey(text: string): string {
  return text.slice(0, 6);
}

/**
 * Round key with its label underneath — no small print: in a call, a key's own name has to be enough.
 * Disabled keys use aria-disabled so focus never drops out from under a keyboard user when the
 * phase changes, and the three keys keep their size and position in every phase. Only the glyph
 * inside changes, and it turns over in place: the button itself is never replaced or delayed.
 */
function CallKey({ label, ariaLabel, pressed, disabled, onPress, className = '', children }: CallKeyProps) {
  return (
    <div className={`callkey ${className}`}>
      <button
        type="button"
        className="callkey__btn"
        onClick={() => {
          if (!disabled) onPress?.();
        }}
        aria-disabled={disabled || undefined}
        aria-pressed={pressed}
        aria-label={ariaLabel}
      >
        <span key={label} className="callkey__glyph" aria-hidden="true">
          {children}
        </span>
        {!ariaLabel && <span className="sr-only">{label}</span>}
      </button>
      <span className="callkey__label" aria-hidden="true">
        {label}
      </span>
    </div>
  );
}

/** What has been said so far in this temporary conversation. It stays after hanging up. */
function CallLog({ messages, compact = false }: { messages: Message[]; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useDomId('calllog');

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <section className={`calllog ${compact ? 'calllog--compact' : ''}`} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="calllog__h">
        文字记录
        <span className="calllog__sub">不会自动保存</span>
      </h3>
      {/* Replies are already spoken aloud; reading them again would talk over 面包. */}
      <div className="calllog__scroll" ref={ref} tabIndex={0} role="log" aria-live="off" aria-labelledby={`${id}-h`}>
        {messages.length === 0 ? (
          <p className="calllog__empty">说过的话会一句一句出现在这里。</p>
        ) : (
          <ol className="calllog__list">
            {messages.map((m) => (
              <li key={m.id} className={`calllog__item calllog__item--${m.role}`}>
                <span className="calllog__who">{m.role === 'user' ? '你' : '面包'}</span>
                <p className="calllog__text">{m.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
