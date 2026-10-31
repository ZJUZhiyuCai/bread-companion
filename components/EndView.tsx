'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, MessageCircle } from 'lucide-react';
import { CardView } from './CardView';
import { LampScene } from './NightWindow';
import { SavePreview } from './SavePreview';
import { cardEvidence, isCardSaved, type EvidenceContext } from './labels';
import type { BreadVM } from './vm';

interface EndViewProps {
  vm: BreadVM;
  onOpenArchive: () => void;
  onReset: () => void;
  onAgain: () => void;
}

/** Reads only state.endSnapshot — sources are already cleared and nothing here talks to a model or plays audio. */
export function EndView({ vm, onOpenArchive, onReset, onAgain }: EndViewProps) {
  const snapshot = vm.state.endSnapshot;
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<null | 'again' | 'reset'>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const ctx: EvidenceContext = { sources: null, snapshot: snapshot?.evidence ?? [] };
  const evidence = snapshot ? cardEvidence(snapshot.card, snapshot.findings, ctx) : [];
  const saved = snapshot ? isCardSaved(snapshot.card, vm.savedCases) : false;

  const leave = (kind: 'again' | 'reset') => {
    if (snapshot && !saved) {
      setConfirmLeave(kind);
      return;
    }
    if (kind === 'again') onAgain();
    else onReset();
  };

  return (
    <main id="main" className="end">
      <div className="end__scene">
        <LampScene lit={false} idPrefix="end-lamp" />
      </div>

      <div className="end__content">
        <h1 ref={headingRef} tabIndex={-1} className="end__title">
          今晚先停在这里。
        </h1>
        <p className="end__lede">录音、回应和播放都停下了，之后再到的结果也不会出现。没有问卷，也没有要做的下一步。</p>

        {snapshot ? (
          <section className="end__card" aria-labelledby="end-card-h">
            <h2 id="end-card-h" className="end__sub">
              {saved ? '这张已经留下了' : '这张卡片还在桌上'}
            </h2>
            {!saved && <p className="small muted">它只在这个页面里，关掉或刷新就没有了。留不留，由你决定。</p>}
            <CardView
              card={snapshot.card}
              findings={snapshot.findings}
              ctx={ctx}
              readOnly
              saved={saved}
              onRequestSave={() => setSaveOpen(true)}
              onExport={vm.exportCard}
            />
            {snapshot.confirmedPractice.length > 0 && (
              <section className="end__practice" aria-labelledby="end-pr-h">
                <h3 id="end-pr-h" className="end__sub end__sub--sm">
                  练过的题
                </h3>
                <ul className="practice-list">
                  {snapshot.confirmedPractice.map((p) => (
                    <li key={p.id}>
                      <p className="practice-list__q">{p.question}</p>
                      <p className="prewrap small">{p.answerOutline}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>
        ) : (
          <p className="end__none">这次没有要留下的东西，所以什么都不会存。这也是一种好好结束。</p>
        )}

        <div className="end__actions">
          {confirmLeave ? (
            <div className="inline-confirm" role="group" aria-label="确认清掉这张卡片">
              <p>这张卡片还没留下。{confirmLeave === 'again' ? '重新开始' : '回到开始'}后，它会从页面上消失。</p>
              <div className="row gap-s wrap">
                <button type="button" className="btn btn--primary" onClick={() => setSaveOpen(true)}>
                  先留下它
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => (confirmLeave === 'again' ? onAgain() : onReset())}>
                  不用了，清掉
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmLeave(null)}>
                  再想想
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn--quiet" onClick={() => leave('again')}>
                <MessageCircle aria-hidden="true" /> 再说一会儿
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => leave('reset')}>
                回到开始
              </button>
              <button type="button" className="btn btn--ghost" onClick={onOpenArchive}>
                <Archive aria-hidden="true" /> 以前留下的
              </button>
            </>
          )}
        </div>
        <p className="end__fine small muted">“再说一会儿”会开始一次新的对话，刚才的聊天不会带过去。</p>
      </div>

      {snapshot && (
        <SavePreview
          open={saveOpen}
          onClose={() => {
            setSaveOpen(false);
            setConfirmLeave(null);
          }}
          card={snapshot.card}
          liveCard={vm.currentCard ?? snapshot.card}
          evidence={evidence}
          practice={snapshot.confirmedPractice}
          notice={vm.notice}
          error={vm.error}
          savedCases={vm.savedCases}
          clearNotice={vm.clearNotice}
          onSave={vm.saveCard}
          onExport={vm.exportCard}
        />
      )}
    </main>
  );
}
