'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, Hand, LoaderCircle, MessageSquareText, Mic, MicOff, Pause, Phone, PhoneOff, RotateCcw } from 'lucide-react';
import type { Message } from '@/domain/types';
import { BreadBuddy } from './BreadBuddy';
import { CALL_RUNNING, IDLE_CALL, buddyForCall, callMeta } from './call';
import { useDomId } from './hooks';
import { formatClock } from './labels';
import type { BreadVM } from './vm';

interface CallRoomProps {
  vm: BreadVM;
  /** Wide screens keep the transcript open beside the call. */
  wide: boolean;
  onHangup: () => void;
}

interface PrimaryKey {
  label: string;
  icon: ReactNode;
  onPress?: () => void;
  /** Visible under the key when it can't be used yet. */
  note?: string;
  tone: 'go' | 'cut' | 'wait';
}

/**
 * The voice call. The lights go down, 面包 puts on a headset, and one big key in the middle always
 * does the single most useful thing for the current phase. Hang up keeps the text; nothing is faked.
 */
export function CallRoom({ vm, wide, onHangup }: CallRoomProps) {
  const call = vm.call ?? IDLE_CALL;
  const { phase } = call;
  const meta = callMeta(call);
  const id = useDomId('callroom');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [showLog, setShowLog] = useState(false);
  const [announce, setAnnounce] = useState('');
  const messages = vm.state.messages;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  // One quiet line per phase. The reply itself is heard, so captions are not read out a second time.
  useEffect(() => {
    if (phase !== 'idle' && phase !== 'error') setAnnounce(meta.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const running = CALL_RUNNING.includes(phase);
  const canMute = call.active && phase !== 'connecting' && phase !== 'paused' && phase !== 'error';

  const primary: PrimaryKey = (() => {
    switch (phase) {
      case 'listening':
        return call.heardSpeech
          ? { label: '说完了', icon: <Check aria-hidden="true" />, onPress: vm.finishCallTurn, tone: 'go' }
          : { label: '说完了', icon: <Check aria-hidden="true" />, note: '说完停一下也行', tone: 'wait' };
      case 'transcribing':
      case 'thinking':
      case 'speaking':
        return { label: '插话', icon: <Hand aria-hidden="true" />, onPress: vm.interruptCall, tone: 'cut' };
      case 'muted':
        return { label: '打开麦克风', icon: <Mic aria-hidden="true" />, onPress: vm.toggleCallMute, tone: 'go' };
      case 'paused':
        return { label: '继续通话', icon: <Phone aria-hidden="true" />, onPress: () => void vm.resumeCall(), tone: 'go' };
      case 'error':
        return { label: '再试一次', icon: <RotateCcw aria-hidden="true" />, onPress: () => void vm.resumeCall(), tone: 'go' };
      default:
        return { label: '接通中', icon: <LoaderCircle aria-hidden="true" className="spin" />, note: '马上就好', tone: 'wait' };
    }
  })();

  const level = phase === 'listening' && !call.muted ? Math.max(0, Math.min(1, call.level || 0)) : 0;

  return (
    <section
      className={`callroom ${wide ? 'callroom--wide' : ''} ${showLog && !wide ? 'is-log' : ''}`}
      data-phase={phase}
      aria-labelledby={`${id}-h`}
    >
      <div className="callroom__main">
        <header className="callroom__bar">
          <p className="callroom__live">
            <span className="callroom__pulse" aria-hidden="true" />
            {phase === 'connecting'
              ? '正在接通'
              : phase === 'paused'
                ? '通话暂停中'
                : phase === 'error'
                  ? '通话没接上'
                  : '和面包语音中'}
            <time className="callroom__time" dateTime={`PT${Math.floor(call.elapsedSeconds)}S`}>
              {formatClock(call.elapsedSeconds)}
            </time>
          </p>
          <p className="callroom__ai">
            <span className="callroom__ai-tag">AI</span>网页里的语音对话，不是电话线路
          </p>
        </header>

        <div className="callroom__stage" style={{ '--lvl': level.toFixed(3) } as CSSProperties}>
          <div className="callroom__halo" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <BreadBuddy state={buddyForCall(call)} level={level} headset decorative className="callroom__buddy" />
        </div>

        <div className="callroom__status">
          <h2 id={`${id}-h`} ref={headingRef} tabIndex={-1} className="callroom__phase">
            {meta.title}
          </h2>
          <p className="callroom__hint">{phase === 'paused' && call.error ? call.error : meta.hint}</p>
          {phase === 'error' && call.error && (
            <p className="callroom__error" role="alert">
              {call.error}
            </p>
          )}
        </div>

        {showLog && !wide ? (
          <CallLog messages={messages} compact />
        ) : (
          <div className="callroom__captions">
            {call.lastHeard && (
              <p className="cap cap--you">
                <span className="cap__who">你</span>
                <span className="cap__text">{call.lastHeard}</span>
              </p>
            )}
            {call.caption ? (
              <p className={`cap cap--bread ${phase === 'speaking' ? 'is-live' : ''}`}>
                <span className="cap__who">面包</span>
                <span className="cap__text">{call.caption}</span>
              </p>
            ) : (
              !call.lastHeard && (
                <p className="cap cap--empty">
                  开个头就好，比如“今天有点累”，或者“我刚收到拒信”。
                </p>
              )
            )}
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
            note={primary.note}
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
              <Pause aria-hidden="true" /> 暂停
            </button>
          )}
          {!wide && (
            <button
              type="button"
              className="callroom__link"
              onClick={() => setShowLog((v) => !v)}
              aria-expanded={showLog}
            >
              <MessageSquareText aria-hidden="true" />
              {showLog ? '回到字幕' : `文字记录${messages.length ? `（${messages.length}）` : ''}`}
            </button>
          )}
          {phase === 'error' && (
            <button type="button" className="callroom__link" onClick={onHangup}>
              挂断，改成打字
            </button>
          )}
        </div>
      </div>

      {wide && (
        <aside className="callroom__side">
          <CallLog messages={messages} />
        </aside>
      )}

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </section>
  );
}

interface CallKeyProps {
  label: string;
  ariaLabel?: string;
  note?: string;
  pressed?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Round key with its label underneath. Disabled keys use aria-disabled so focus never drops
 * out from under a keyboard user when the phase changes.
 */
function CallKey({ label, ariaLabel, note, pressed, disabled, onPress, className = '', children }: CallKeyProps) {
  const noteId = useDomId('callkey-note');
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
        aria-describedby={note ? noteId : undefined}
      >
        {children}
        {!ariaLabel && <span className="sr-only">{label}</span>}
      </button>
      <span className="callkey__label" aria-hidden="true">
        {label}
      </span>
      {note && (
        <span id={noteId} className="callkey__note">
          {note}
        </span>
      )}
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
        <span className="calllog__sub">挂断后也留在这段对话里，不会自动保存</span>
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
