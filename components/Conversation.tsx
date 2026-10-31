'use client';

import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { HeartHandshake, LoaderCircle, Paperclip, Phone, PhoneOff, RotateCcw, Square, Volume2 } from 'lucide-react';
import type { Card, Message } from '@/domain/types';
import { CardSlip } from './CardView';
import { StateAvatar } from './StateAvatar';
import { useReducedMotion } from './hooks';
import { formatClock } from './labels';

/** Where a voice call started and ended, as message indexes, so the transcript reads in place. */
export interface CallMark {
  start: number;
  end: number | null;
  seconds: number;
}

/** First lines people can take and change. They only fill the box; nothing is sent for you. */
const STARTERS = ['刚收到拒信，有点懵', '不想分析，就想吐槽一下', '我觉得自己表现得很差', '陪我待一会儿就好'];

interface ConversationProps {
  messages: Message[];
  welcomeIntent: boolean;
  reviewIntent: boolean;
  supportGuidance: boolean;
  thinking: boolean;
  ttsAvailable: boolean | null;
  ttsReason?: string;
  canPlay: boolean;
  speakingId: string | null;
  speakPendingId: string | null;
  isSpeaking: boolean;
  onSpeak: (id: string, text: string) => void;
  onStop: () => void;
  onOpenSource: (id: string) => void;
  card: Card | null;
  cardSaved: boolean;
  onOpenCard: () => void;
  onSaveCard: () => void;
  onRedoCard: (card: Card) => void;
  busy: boolean;
  canAct: boolean;
  callMarks: CallMark[];
  /** The last reply failed and can be asked for again, as-is. */
  canRetry?: boolean;
  onRetry?: () => void;
  /** Puts a starter line into the composer. */
  onStarter?: (text: string) => void;
  /** Extra content under the opening greeting (the phone card on small screens). */
  emptyExtra?: ReactNode;
}

export function Conversation(props: ConversationProps) {
  const {
    messages,
    welcomeIntent,
    reviewIntent,
    supportGuidance,
    thinking,
    ttsAvailable,
    ttsReason,
    canPlay,
    speakingId,
    speakPendingId,
    isSpeaking,
    onSpeak,
    onStop,
    onOpenSource,
    card,
    cardSaved,
    onOpenCard,
    onSaveCard,
    onRedoCard,
    busy,
    canAct,
    callMarks,
    canRetry = false,
    onRetry,
    onStarter,
    emptyExtra,
  } = props;
  const showRetry = canRetry && !!onRetry && !thinking && canAct;
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const cardKey = card ? `${card.id}:${card.revision}:${card.validity}` : '';
  const marksKey = callMarks.map((k) => `${k.start}-${k.end}`).join(',');
  useEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
  }, [messages.length, thinking, cardKey, marksKey, showRetry, reduced]);

  const firstAssistantId = messages.find((m) => m.role === 'assistant')?.id;

  return (
    <div className="conversation" ref={scrollRef}>
      <div className="conversation__inner">
        <p className="conv-opening">
          <span className="conv-opening__line" aria-hidden="true" />
          <span>今晚的对话从这里开始</span>
          <span className="conv-opening__line" aria-hidden="true" />
        </p>

        {supportGuidance && (
          <section className="support" aria-labelledby="support-h">
            <HeartHandshake aria-hidden="true" className="support__icon" />
            <div>
              <h2 id="support-h" className="support__title">
                先把面试放一放。
              </h2>
              <p>如果你现在可能伤害自己，请先联系一位你信任的人陪着你；如果危险就在眼前，请联系当地的急救或紧急服务。</p>
              {/* Kept, not trimmed further: this one has to be unambiguous. */}
              <p className="small muted">面包是一个程序，不能代替真人或专业帮助，也不会替你联系任何人。</p>
            </div>
          </section>
        )}

        {messages.length === 0 && !thinking && (
          <div className="conv-empty">
            <div className="hello">
              <span className="msg__mark" aria-hidden="true">
                <StateAvatar state="idle" size="xs" decorative />
              </span>
              <div className="hello__bubble">
                <p className="hello__title">{reviewIntent ? '我们一起看看那一段。' : '想从哪里说起都可以。'}</p>
                <p className="hello__body">
                  {reviewIntent
                    ? '你记得的回答、拒信原文、岗位描述都可以，直接说或者粘贴进来。'
                    : '可以是这次面试，也可以只是现在的感受。'}
                </p>
              </div>
            </div>
            {!reviewIntent && onStarter && canAct && (
              <div className="starters" role="group" aria-labelledby="starters-h">
                <p id="starters-h" className="starters__h">
                  不知道怎么开口，点一句改成你的话
                </p>
                <div className="starters__list">
                  {STARTERS.map((s) => (
                    <button key={s} type="button" className="starter" onClick={() => onStarter(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {emptyExtra}
          </div>
        )}

        <div role="log" aria-label="对话" aria-live="polite" aria-relevant="additions">
          <ol className="messages">
            {messages.map((m, i) => {
              const marks = marksAt(callMarks, i);
              if (m.role === 'user') {
                return (
                  <Fragment key={m.id}>
                    {marks}
                    <li className="msg msg--user">
                      <div className="msg__note">
                        <span className="sr-only">你说：</span>
                        <p className="msg__text">{m.text}</p>
                        {m.sourceId && (
                          <button type="button" className="msg__source" onClick={() => onOpenSource(m.sourceId!)}>
                            <Paperclip aria-hidden="true" /> 已放进材料 · 看看
                          </button>
                        )}
                      </div>
                    </li>
                  </Fragment>
                );
              }
              const isWelcome = welcomeIntent && m.id === firstAssistantId;
              const speakingThis = isSpeaking && speakingId === m.id;
              const pendingThis = speakPendingId === m.id && !speakingThis;
              return (
                <Fragment key={m.id}>
                {marks}
                <li className={`msg msg--bread ${isWelcome ? 'msg--welcome' : ''} ${speakingThis ? 'is-speaking' : ''}`}>
                  <span className="msg__mark" aria-hidden="true">
                    <StateAvatar state={speakingThis ? 'speaking' : 'idle'} size="xs" decorative />
                  </span>
                  <div className="msg__body">
                    <span className="sr-only">面包说：</span>
                    {isWelcome && <p className="msg__kicker">给你的一小段话</p>}
                    <p className="msg__text">{m.text}</p>
                    <div className="msg__meta">
                      {m.serviceMode === 'mock' && <span className="tag tag--mock">演示回复</span>}
                      {canPlay &&
                        (speakingThis ? (
                          <button type="button" className="pill pill--stop" onClick={onStop} aria-label="停止播放">
                            <Square aria-hidden="true" /> 停
                            <span className="sr-only">止播放</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={`pill ${isWelcome ? 'pill--warm' : ''}`}
                            onClick={() => onSpeak(m.id, m.text)}
                            disabled={!!speakPendingId || isSpeaking}
                            aria-label={isWelcome ? '播放这段话' : '念给我听'}
                          >
                            {pendingThis ? (
                              <>
                                <LoaderCircle aria-hidden="true" className="spin" /> 准备声音…
                              </>
                            ) : (
                              <>
                                <Volume2 aria-hidden="true" /> 听
                              </>
                            )}
                          </button>
                        ))}
                    </div>
                    {/* Only the one case that changes what's possible — not a note on what you may do. */}
                    {isWelcome && ttsAvailable === false && (
                      <p className="msg__after">
                        现在没有语音播报{ttsReason ? `（${ttsReason}）` : ''}，读文字就好。
                      </p>
                    )}
                  </div>
                </li>
                </Fragment>
              );
            })}
            {marksAt(callMarks, messages.length)}
            {/* Right under the line that went unanswered: the line stays, only the reply is asked for again. */}
            {showRetry && (
              <li className="msg-retry">
                <span className="msg-retry__text">这句还没回上来</span>
                <button type="button" className="pill pill--warm" onClick={onRetry}>
                  <RotateCcw aria-hidden="true" /> 再试一次
                </button>
              </li>
            )}
            {thinking && (
              <li className="msg msg--bread msg--thinking">
                <span className="msg__mark" aria-hidden="true">
                  <StateAvatar state="generating" size="xs" decorative />
                </span>
                <div className="msg__body">
                  <p className="msg__text msg__text--quiet">
                    在想
                    <span className="dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </p>
                </div>
              </li>
            )}
          </ol>
        </div>

        {card && (
          <CardSlip
            card={card}
            saved={cardSaved}
            busy={busy}
            canAct={canAct}
            onOpen={onOpenCard}
            onSave={onSaveCard}
            onRedo={() => onRedoCard(card)}
          />
        )}
        <div ref={endRef} className="conversation__end" />
      </div>
    </div>
  );
}

/** Dividers that belong right before message `i`, in the order the calls happened. */
function marksAt(callMarks: CallMark[], i: number): ReactNode {
  const out: ReactNode[] = [];
  callMarks.forEach((k, n) => {
    if (k.start === i && k.end === i) out.push(<CallDivider key={`b${n}`} kind="brief" seconds={k.seconds} />);
    else if (k.start === i) out.push(<CallDivider key={`s${n}`} kind="start" />);
    else if (k.end === i) out.push(<CallDivider key={`e${n}`} kind="end" seconds={k.seconds} />);
  });
  return out.length ? out : null;
}

function CallDivider({ kind, seconds = 0 }: { kind: 'start' | 'end' | 'brief'; seconds?: number }) {
  const Icon = kind === 'start' ? Phone : PhoneOff;
  return (
    <li className={`call-divider call-divider--${kind}`}>
      <span className="call-divider__line" aria-hidden="true" />
      <span className="call-divider__text">
        <Icon aria-hidden="true" />
        {kind === 'start' && '语音通话'}
        {kind === 'end' && `通话结束 · ${formatClock(seconds)}`}
        {kind === 'brief' && `打过一次电话 · ${formatClock(seconds)}`}
      </span>
      <span className="call-divider__line" aria-hidden="true" />
    </li>
  );
}
