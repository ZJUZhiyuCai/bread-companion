'use client';

import { useEffect, useRef } from 'react';
import { HeartHandshake, LoaderCircle, Paperclip, Square, Volume2 } from 'lucide-react';
import type { Card, Message } from '@/domain/types';
import { CardSlip } from './CardView';
import { StateAvatar } from './StateAvatar';
import { useReducedMotion } from './hooks';

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
  } = props;
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
  useEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
  }, [messages.length, thinking, cardKey, reduced]);

  const firstAssistantId = messages.find((m) => m.role === 'assistant')?.id;

  return (
    <div className="conversation" ref={scrollRef}>
      <div className="conversation__inner">
        <p className="conv-opening">
          <span className="conv-opening__line" aria-hidden="true" />
          <span>
            今晚的对话从这里开始。面包是 AI，不是真人，也没有人在后台看着；这些话默认不会保存。
          </span>
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
              <p className="small muted">面包是一个程序，不能代替真人或专业帮助，也不会替你联系任何人。停止、结束随时都可以用。</p>
            </div>
          </section>
        )}

        {messages.length === 0 && !thinking && (
          <div className="conv-empty">
            <StateAvatar state="idle" size="lg" decorative />
            <p className="conv-empty__title">{reviewIntent ? '我们一起看看那一段。' : '想从哪里说起都可以。'}</p>
            <p className="conv-empty__body">
              {reviewIntent
                ? '你记得的回答、拒信原文、岗位描述都可以，直接说或者粘贴进来。'
                : '可以是这次面试，也可以只是现在的感受。不用说公司名，也不用先想清楚。'}
            </p>
          </div>
        )}

        <div role="log" aria-label="对话" aria-live="polite" aria-relevant="additions">
          <ol className="messages">
            {messages.map((m) => {
              if (m.role === 'user') {
                return (
                  <li key={m.id} className="msg msg--user">
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
                );
              }
              const isWelcome = welcomeIntent && m.id === firstAssistantId;
              const speakingThis = isSpeaking && speakingId === m.id;
              const pendingThis = speakPendingId === m.id && !speakingThis;
              return (
                <li key={m.id} className={`msg msg--bread ${isWelcome ? 'msg--welcome' : ''} ${speakingThis ? 'is-speaking' : ''}`}>
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
                      {speakingThis && <span className="msg__caption">正在念，上面的文字就是字幕</span>}
                    </div>
                    {isWelcome && (
                      <p className="msg__after">
                        {ttsAvailable === false && `现在没有语音播报${ttsReason ? `（${ttsReason}）` : ''}，读文字就好。`}
                        听完想说就说，不想说，点右上角“结束”也完全可以。
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
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
                  <p className="msg__after">想好、核对过才会一起给你。不想等就点“停止”。</p>
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
