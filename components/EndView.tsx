'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, MessageCircle, Phone } from 'lucide-react';
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
  /** A new conversation that starts as a call — only after this tap. */
  onCall: () => void;
}

type Leave = 'again' | 'reset' | 'call';

/** Reads only state.endSnapshot — sources are already cleared and nothing here talks to a model or plays audio. */
export function EndView({ vm, onOpenArchive, onReset, onAgain, onCall }: EndViewProps) {
  const snapshot = vm.state.endSnapshot;
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<null | Leave>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const ctx: EvidenceContext = { sources: null, snapshot: snapshot?.evidence ?? [] };
  const evidence = snapshot ? cardEvidence(snapshot.card, snapshot.findings, ctx) : [];
  const saved = snapshot ? isCardSaved(snapshot.card, vm.savedCases) : false;

  const go = (kind: Leave) => {
    if (kind === 'again') onAgain();
    else if (kind === 'call') onCall();
    else onReset();
  };

  const leave = (kind: Leave) => {
    if (snapshot && !saved) {
      setConfirmLeave(kind);
      return;
    }
    go(kind);
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
        {/* One device fact, one release. The late-result guarantee is the backend's job, not a sentence here. */}
        <p className="end__lede">麦克风和声音都停了。没有问卷，也没有要做的下一步。</p>

        {snapshot ? (
          <section className="end__card" aria-labelledby="end-card-h">
            <h2 id="end-card-h" className="end__sub">
              {saved ? '这张已经留下了' : '这张卡片还在桌上'}
            </h2>
            {!saved && <p className="small muted">关掉或刷新页面，它就没有了。</p>}
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
          <p className="end__none">这次没有要留下的东西。这也是一种好好结束。</p>
        )}

        <div className="end__actions">
          {confirmLeave ? (
            <div className="inline-confirm" role="group" aria-label="确认清掉这张卡片">
              <p>这张卡片还没留下。{confirmLeave === 'reset' ? '回到开始' : '重新开始'}后，它会从页面上消失。</p>
              <div className="row gap-s wrap">
                <button type="button" className="btn btn--primary" onClick={() => setSaveOpen(true)}>
                  先留下它
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => go(confirmLeave)}>
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
              <button type="button" className="btn btn--ghost" onClick={() => leave('call')}>
                <Phone aria-hidden="true" /> 打个电话
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
        {/* Kept: "再说一会儿" reads like "continue", and it doesn't. Prevents a real surprise, so it stays — short. */}
        {!confirmLeave && <p className="end__fine small muted">都会开始新的一段，刚才的聊天不带过去。</p>}
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
