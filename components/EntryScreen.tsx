'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, Archive, Headphones, MessageCircle, ScanText } from 'lucide-react';
import type { Capabilities } from '@/domain/types';
import { CallLauncher } from './Companion';
import { LampScene } from './NightWindow';
import { AiStamp } from './ServiceStatus';
import { useAutoGrow, useFlash } from './hooks';

interface EntryScreenProps {
  caps: Capabilities | null;
  savedCount: number;
  onTalk: (firstText?: string) => void;
  onCall: (draft?: string) => void;
  onWelcome: () => void;
  onReview: () => void;
  onOpenArchive: () => void;
  onOpenAbout: () => void;
}

export function EntryScreen(props: EntryScreenProps) {
  const { caps, savedCount, onTalk, onCall, onWelcome, onReview, onOpenArchive, onOpenAbout } = props;
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, text, 200);
  const waving = useFlash(true, 2800);
  const maxInput = caps?.limits.maxInputChars ?? null;
  const over = maxInput !== null && text.length > maxInput;
  const typing = text.trim().length > 0;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || over) return;
    onTalk(t);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Touch keyboards keep Enter as a newline; checked at event time so server and client render the same.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    submit();
  };

  const welcomeSub = !caps
    ? '一段二三十秒的话，文字先到'
    : caps.tts.available
      ? '一段二三十秒的话。文字先到，想听再点'
      : '一段二三十秒的话，现在以文字呈现';

  return (
    <main id="main" className="entry">
      <div className="entry__top">
        <p className="wordmark">
          面包<span className="wordmark__sub">收到拒信的那个晚上</span>
        </p>
        <AiStamp caps={caps} onClick={onOpenAbout} />
      </div>

      <div className="entry__stage">
        <div className="entry__hero">
          <p className="hello-bubble">
            <span className="hello-bubble__big">嗨，我是面包。</span>
            <span className="hello-bubble__small">一个 AI。今晚想说什么，我都听着。</span>
          </p>
          <LampScene state={waving ? 'wave' : typing ? 'attentive' : 'idle'} idPrefix="entry-lamp" className="entry__scene" />
        </div>

        <div className="entry__content">
          <h1 className="entry__title">今晚，先说说。</h1>
          <p className="entry__lede">打字可以，打个电话也可以。说到哪儿算哪儿，想停的时候随时停。</p>

          <div className="doors">
            <form className="first-note door" onSubmit={submit}>
              <label htmlFor="entry-first" className="first-note__label">
                写下第一句，不用整理好
              </label>
              <textarea
                id="entry-first"
                ref={ref}
                className="first-note__input"
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                placeholder="比如：刚收到拒信。我准备了三天，最后只收到一句“不合适”。"
                aria-describedby="entry-first-help"
                aria-invalid={over || undefined}
              />
              <div className="first-note__row">
                <p id="entry-first-help" className={`small ${over ? 'warn-text' : 'muted'}`}>
                  {over ? `超过 ${maxInput} 字了，可以先说一部分` : '不用填公司，不用传简历，也不用给心情打分。'}
                </p>
                <button type="submit" className="btn btn--primary" disabled={!text.trim() || over}>
                  说给面包 <ArrowRight aria-hidden="true" />
                </button>
              </div>
            </form>

            <div className="door door--call">
            <CallLauncher variant="hero" caps={caps} onCall={() => onCall(text)} />
            </div>
          </div>

          <div className="ways">
            <p className="ways__title" id="ways-title">
              或者，换一种开始
            </p>
            <ul className="ways__list" aria-labelledby="ways-title">
              <li>
                <button type="button" className="way" onClick={() => onTalk()}>
                  <MessageCircle aria-hidden="true" className="way__icon" />
                  <span className="way__text">
                    <span className="way__title">我想说几句</span>
                    <span className="way__sub">进去再慢慢打字，或者自己点开录一段</span>
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className="way" onClick={onWelcome}>
                  <Headphones aria-hidden="true" className="way__icon" />
                  <span className="way__text">
                    <span className="way__title">现在不想说，先听一小段</span>
                    <span className="way__sub">{welcomeSub}，不会打开麦克风</span>
                  </span>
                </button>
              </li>
              <li>
                <button type="button" className="way" onClick={onReview}>
                  <ScanText aria-hidden="true" className="way__icon" />
                  <span className="way__text">
                    <span className="way__title">我想直接复盘</span>
                    <span className="way__sub">不用填表，面包先问你一个问题</span>
                  </span>
                </button>
              </li>
            </ul>
          </div>

          <footer className="entry__foot">
            <button type="button" className="drawer-link" onClick={onOpenArchive} aria-haspopup="dialog">
              <Archive aria-hidden="true" />
              <span>
                以前留下的{savedCount > 0 ? `（${savedCount}）` : ''}
                <small>只在这台设备的这个浏览器里</small>
              </span>
            </button>
            <p className="entry__fine small muted">
              这次对话默认不保存，结束或刷新就没有了。面包是 AI，提供一般性的陪伴和整理，不是心理诊断或治疗。
            </p>
          </footer>
        </div>
      </div>
    </main>
  );
}
