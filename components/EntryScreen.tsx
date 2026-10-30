'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Archive, ArrowRight, Headphones, Info, MessageCircle, NotebookPen } from 'lucide-react';
import type { Capabilities } from '@/domain/types';
import { NightWindow } from './NightWindow';
import { ServiceChips } from './ServiceStatus';

interface EntryScreenProps {
  caps: Capabilities | null;
  savedCount: number;
  onTalk: (firstText?: string) => void;
  onWelcome: () => void;
  onReview: () => void;
  onOpenArchive: () => void;
  onOpenStatus: () => void;
}

export function EntryScreen({ caps, savedCount, onTalk, onWelcome, onReview, onOpenArchive, onOpenStatus }: EntryScreenProps) {
  const [text, setText] = useState('');
  const maxInput = caps?.limits.maxInputChars ?? null;
  const over = maxInput !== null && text.length > maxInput;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const t = text.trim();
    if (!t || over) return;
    onTalk(t);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Desktop-ish behavior; on touch keyboards Enter stays a newline (checked via pointer media at event time).
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    submit();
  };

  const welcomeSub = !caps
    ? '一段二三十秒的欢迎词，先显示文字'
    : caps.tts.available
      ? '一段二三十秒的欢迎词。文字先到，要听再点播放'
      : '一段二三十秒的欢迎词。现在没有语音播报，会以文字呈现';

  return (
    <main id="main" className="entry">
      <div className="entry__scene">
        <NightWindow lit />
      </div>

      <div className="entry__content">
        <p className="entry__brand">
          <span className="entry__brand-name">面包</span>
          <span className="entry__brand-sub">收到拒信的那个晚上</span>
        </p>
        <h1 className="entry__title">今晚，先说说。</h1>
        <p className="entry__lede">可以聊这次面试，也可以只说说现在的感受。想停的时候，随时停。</p>

        <ul className="choices" aria-label="怎么开始">
          <li>
            <button type="button" className="choice choice--talk" onClick={() => onTalk()}>
              <span className="choice__icon" aria-hidden="true">
                <MessageCircle />
              </span>
              <span className="choice__text">
                <span className="choice__title">我想说几句</span>
                <span className="choice__sub">用文字，或者自己点开录音。说多少都行</span>
              </span>
              <ArrowRight aria-hidden="true" className="choice__go" />
            </button>
          </li>
          <li>
            <button type="button" className="choice choice--listen" onClick={onWelcome}>
              <span className="choice__icon" aria-hidden="true">
                <Headphones />
              </span>
              <span className="choice__text">
                <span className="choice__title">现在不想说，先听一小段</span>
                <span className="choice__sub">{welcomeSub}，不会打开麦克风</span>
              </span>
              <ArrowRight aria-hidden="true" className="choice__go" />
            </button>
          </li>
          <li>
            <button type="button" className="choice choice--review" onClick={onReview}>
              <span className="choice__icon" aria-hidden="true">
                <NotebookPen />
              </span>
              <span className="choice__text">
                <span className="choice__title">我想直接复盘</span>
                <span className="choice__sub">放一段你愿意讨论的材料，看事实、推断和未知</span>
              </span>
              <ArrowRight aria-hidden="true" className="choice__go" />
            </button>
          </li>
        </ul>

        <form className="entry__write" onSubmit={submit}>
          <label htmlFor="entry-first" className="entry__write-label">
            或者，直接写下第一句
          </label>
          <div className="entry__write-box">
            <textarea
              id="entry-first"
              className="entry__write-input"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder="比如：刚收到拒信。我准备了三天，最后只收到一句不合适。"
              aria-describedby="entry-first-help"
              aria-invalid={over || undefined}
            />
            <button type="submit" className="btn btn--primary" disabled={!text.trim() || over}>
              说给面包
            </button>
          </div>
          <p id="entry-first-help" className={`small ${over ? 'warn-text' : 'muted'}`}>
            {over
              ? `超过 ${maxInput} 字了，可以先发一部分`
              : '不需要填公司、简历，也不用给心情打分。要放材料的话，只粘贴你愿意讨论的片段。'}
          </p>
        </form>

        <footer className="entry__foot">
          <ServiceChips caps={caps} />
          <div className="entry__links">
            <button type="button" className="link-btn" onClick={onOpenStatus}>
              <Info aria-hidden="true" /> 服务状态与数据处理
            </button>
            <button type="button" className="archive-link" onClick={onOpenArchive}>
              <Archive aria-hidden="true" />
              <span>
                本设备档案{savedCount > 0 ? `（${savedCount}）` : ''}
                <small>以前主动保存的卡片，和今晚的对话分开</small>
              </span>
            </button>
          </div>
          <p className="entry__fine small muted">
            默认是临时会话，结束或刷新后对话就没有了。面包提供一般性的陪伴和整理，不是心理诊断或治疗，也不知道招聘方没有公开的决定原因。
          </p>
        </footer>
      </div>
    </main>
  );
}
