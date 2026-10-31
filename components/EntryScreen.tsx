'use client';

import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, Archive, Headphones, ScanText } from 'lucide-react';
import type { Capabilities } from '@/domain/types';
import { BrandLogo } from './Brand';
import { CallLauncher } from './Companion';
import { LampScene } from './NightWindow';
import { AiStamp } from './ServiceStatus';
import { useAutoGrow } from './hooks';

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

/**
 * The first screen, for someone who has just been turned down and is tired. It asks for nothing: 面包
 * sits in a low lamp and looks at you, and the page says you can simply stay. Everything else is there
 * when you want it, ordered by how much it costs — listening (no voice, no mic), a note, the phone —
 * and sorting things out waits at the foot of the page until you are ready for it.
 *
 * There is no hello animation: no wave, no hop, no bubble popping in. Nothing moves until you do.
 */
export function EntryScreen(props: EntryScreenProps) {
  const { caps, savedCount, onTalk, onCall, onWelcome, onReview, onOpenArchive, onOpenAbout } = props;
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, text, 200);
  const maxInput = caps?.limits.maxInputChars ?? null;
  const over = maxInput !== null && text.length > maxInput;
  const typing = text.trim().length > 0;

  // One way in for writing. Empty, the note just opens the conversation ("进去慢慢写"); with words in
  // it, it sends them. The old separate "我想说几句" door did the first half of this on its own.
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (over) return;
    const t = text.trim();
    if (t) onTalk(t);
    else onTalk();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Touch keyboards keep Enter as a newline; checked at event time so server and client render the same.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    // Enter on an empty note is not a request to leave the page.
    if (typing) submit();
  };

  // Only the fact that changes what happens: whether there is a voice to play at all.
  const listenSub = caps && !caps.tts.available ? '二三十秒，现在只有文字，不开麦克风' : '二三十秒，不用开口，也不开麦克风';

  return (
    <main id="main" className="entry">
      <div className="entry__top">
        <p className="wordmark">
          <BrandLogo className="wordmark__logo" />
          <span className="sr-only">面包</span>
          <span className="wordmark__sub">收到拒信的那个晚上</span>
        </p>
        <AiStamp caps={caps} onClick={onOpenAbout} />
      </div>

      <div className="entry__stage">
        {/* 面包 and its red phone share one table and one low lamp; the phone is the call button itself. */}
        <div className="entry__hero">
          {/* Says it is an AI once, in its own words, and asks for nothing. */}
          <p className="hello-bubble">
            <span className="hello-bubble__big">我是面包，一个 AI。</span>
            <span className="hello-bubble__small">陪你待一会儿，不说话也行。</span>
          </p>
          <LampScene state={typing ? 'attentive' : 'idle'} className="entry__scene" pokeable phoneNear />
          <CallLauncher variant="hero" caps={caps} onCall={() => onCall(text)} />
        </div>

        <div className="entry__content">
          <h1 className="entry__title">先在这儿待一会儿。</h1>
          <p className="entry__lede">不想说话也没关系。想开口的时候，再开口。</p>

          {/* The lightest thing to do here: listen. No voice from you, no microphone. */}
          <button type="button" className="rest-listen" onClick={onWelcome}>
            <Headphones aria-hidden="true" className="rest-listen__icon" />
            <span className="rest-listen__text">
              <span className="rest-listen__title">先听面包说一小段</span>
              <span className="rest-listen__sub">{listenSub}</span>
            </span>
          </button>

          <form className="first-note" onSubmit={submit}>
            <label htmlFor="entry-first" className="first-note__label">
              想写的时候，写在这儿
            </label>
            <textarea
              id="entry-first"
              ref={ref}
              className="first-note__input"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder="一个词、半句话都可以。"
              aria-describedby="entry-first-help"
              aria-invalid={over || undefined}
            />
            <div className="first-note__row">
              {/* Only speaks up when it has to. */}
              <p id="entry-first-help" className="first-note__help small warn-text">
                {over ? `超过 ${maxInput} 字了，可以先说一部分` : ''}
              </p>
              <button type="submit" className={`btn ${typing ? 'btn--primary' : 'btn--ghost'}`} disabled={over}>
                {typing ? '说给面包' : '进去慢慢写'} <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </form>

          {/* For later: sorting it out, and what was kept before. Always reachable, never first. */}
          <footer className="entry__later">
            <button type="button" className="later-link" onClick={onReview}>
              <ScanText aria-hidden="true" />
              <span>
                想整理的时候，一起复盘这次面试
                <span className="sr-only">：不用填表，面包先问你一个问题</span>
              </span>
            </button>
            <button type="button" className="later-link" onClick={onOpenArchive} aria-haspopup="dialog">
              <Archive aria-hidden="true" />
              <span>
                以前留下的{savedCount > 0 ? `（${savedCount}）` : ''}
                <small>只在这台设备的这个浏览器里</small>
              </span>
            </button>
          </footer>
        </div>
      </div>
    </main>
  );
}
