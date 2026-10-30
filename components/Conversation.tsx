'use client';

import { useEffect, useRef } from 'react';
import { ArrowRight, LoaderCircle, Paperclip, Square, Volume2 } from 'lucide-react';
import type { Card, Message, Mode } from '@/domain/types';
import { StateAvatar } from './StateAvatar';
import { useReducedMotion } from './hooks';
import { CARD_TYPE_LABEL, VALIDITY_META, type AvatarState } from './labels';

const EMPTY_PROMPT: Record<Mode, { title: string; body: string }> = {
  listen: {
    title: '想从哪里说起都可以。',
    body: '可以是这次面试，也可以只是现在的感受。不需要公司名，也不用先整理好。',
  },
  organize: {
    title: '想留一个以后再看的记号。',
    body: '先说说你最在意的那件事。面包会整理成一张小卡片，由你来改字和确认。',
  },
  review: {
    title: '来看一道题。',
    body: '先放一段你愿意讨论的材料：你记得的回答、拒信原文或岗位描述片段。准备好了点“开始复盘”。',
  },
  practice: {
    title: '练一题。',
    body: '在“练一题”里选好题目和一到两个关注点，然后在这里回答。',
  },
};

interface ConversationProps {
  messages: Message[];
  mode: Mode;
  avatarState: AvatarState;
  thinking: boolean;
  welcomeIntent: boolean;
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
  showCardSlip: boolean;
  onOpenCard: () => void;
}

export function Conversation(props: ConversationProps) {
  const {
    messages,
    mode,
    avatarState,
    thinking,
    welcomeIntent,
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
    showCardSlip,
    onOpenCard,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
  }, [messages.length, thinking, showCardSlip, reduced]);

  const firstAssistantId = messages.find((m) => m.role === 'assistant')?.id;
  const empty = EMPTY_PROMPT[mode];

  return (
    <div className="conversation" ref={scrollRef}>
      <div className="conversation__inner">
        {messages.length === 0 && !thinking && (
          <div className="conv-empty">
            <StateAvatar state={avatarState} size="lg" />
            <p className="conv-empty__title">{empty.title}</p>
            <p className="conv-empty__body">{empty.body}</p>
          </div>
        )}

        <div role="log" aria-label="对话" aria-live="polite" aria-relevant="additions">
        <ol className="messages">
          {messages.map((m) => {
            if (m.role === 'user') {
              return (
                <li key={m.id} className="msg msg--user">
                  <div className="msg__body">
                    <span className="sr-only">你说：</span>
                    <p className="msg__text">{m.text}</p>
                    {m.sourceId && (
                      <button type="button" className="msg__source link-btn" onClick={() => onOpenSource(m.sourceId!)}>
                        <Paperclip aria-hidden="true" /> 已放进材料，查看
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
              <li
                key={m.id}
                className={`msg msg--assistant ${isWelcome ? 'msg--welcome' : ''} ${speakingThis ? 'is-speaking' : ''}`}
              >
                <span className="msg__mark" aria-hidden="true">
                  <StateAvatar state={speakingThis ? 'speaking' : 'idle'} size="sm" />
                </span>
                <div className="msg__body">
                  <span className="sr-only">面包说：</span>
                  {isWelcome && <p className="msg__kicker">一小段欢迎词 · 文字先到，要听再点播放</p>}
                  <p className="msg__text">{m.text}</p>
                  <div className="msg__meta">
                    {m.serviceMode === 'mock' && <span className="svc-tag svc-tag--mock">规则演示</span>}
                    {m.serviceMode === 'real' && <span className="svc-tag svc-tag--real">AI 生成</span>}
                    {canPlay &&
                      (speakingThis ? (
                        <button type="button" className="btn btn--sm btn--stop-soft" onClick={onStop}>
                          <Square aria-hidden="true" /> 停止播放
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`btn btn--sm ${isWelcome ? 'btn--quiet' : 'btn--ghost'}`}
                          onClick={() => onSpeak(m.id, m.text)}
                          disabled={!!speakPendingId || isSpeaking}
                        >
                          {pendingThis ? (
                            <>
                              <LoaderCircle aria-hidden="true" className="spin" /> 准备声音…
                            </>
                          ) : (
                            <>
                              <Volume2 aria-hidden="true" /> {isWelcome ? '播放欢迎词' : '播放'}
                            </>
                          )}
                        </button>
                      ))}
                    {speakingThis && <span className="msg__caption small">正在播放，这段文字就是字幕</span>}
                  </div>
                  {isWelcome && ttsAvailable === false && (
                    <p className="small muted">现在没有可用的语音播报{ttsReason ? `（${ttsReason}）` : ''}，读文字就好。</p>
                  )}
                  {isWelcome && (
                    <p className="small muted">听完想说就说，不想说也可以直接结束。</p>
                  )}
                </div>
              </li>
            );
          })}
          {thinking && (
            <li className="msg msg--assistant msg--thinking">
              <span className="msg__mark" aria-hidden="true">
                <StateAvatar state="generating" size="sm" />
              </span>
              <div className="msg__body">
                <p className="msg__text">正在整理回应…</p>
                <p className="small muted">核对完一次显示，可以随时点“停止”。</p>
              </div>
            </li>
          )}
        </ol>
        </div>

        {showCardSlip && card && (
          <button type="button" className={`card-slip is-${card.validity}`} onClick={onOpenCard}>
            <span className="card-slip__scores" aria-hidden="true" />
            <span className="card-slip__text">
              <strong>{CARD_TYPE_LABEL[card.type]}</strong>
              <span>
                {card.title} · 第 {card.revision} 版 · {VALIDITY_META[card.validity].label}
              </span>
            </span>
            <span className="card-slip__go">
              打开看看 <ArrowRight aria-hidden="true" />
            </span>
          </button>
        )}
        <div ref={endRef} className="conversation__end" />
      </div>
    </div>
  );
}
