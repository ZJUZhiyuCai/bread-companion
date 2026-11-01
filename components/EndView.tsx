'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowDown, HardDrive, MessageCircle } from 'lucide-react';
import { CardView } from './CardView';
import { LampScene } from './NightWindow';
import { PhoneGlyph } from './RedPhone';
import { SavePreview } from './SavePreview';
import { CARD_TYPE_LABEL, cardEvidence, isCardSaved, type EvidenceContext } from './labels';
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

/**
 * Reads only state.endSnapshot — sources are already cleared and nothing here talks to a model or plays audio.
 *
 * The order is the order a tired person needs it in: goodnight; what is still on the table and the one
 * key that keeps it; where to go next; and only then the whole card to read. Leaving with a card not
 * kept still asks first, in place — nothing is saved or thrown away on its own.
 */
export function EndView({ vm, onOpenArchive, onReset, onAgain, onCall }: EndViewProps) {
  const snapshot = vm.state.endSnapshot;
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<null | Leave>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  // Where focus goes back to after "再想想": the way out that was just pressed.
  const backTo = useRef<Leave | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (confirmLeave) {
      confirmRef.current?.focus();
      return;
    }
    const kind = backTo.current;
    backTo.current = null;
    if (kind) actionsRef.current?.querySelector<HTMLButtonElement>(`[data-leave='${kind}']`)?.focus();
  }, [confirmLeave]);

  const ctx: EvidenceContext = { sources: null, snapshot: snapshot?.evidence ?? [] };
  const evidence = snapshot ? cardEvidence(snapshot.card, snapshot.findings, ctx) : [];
  const saved = snapshot ? isCardSaved(snapshot.card, vm.savedCases) : false;

  const go = (kind: Leave) => {
    if (kind === 'again') onAgain();
    else if (kind === 'call') onCall();
    else onReset();
  };

  // Down to the whole card, without touching the URL; focus follows so the next Tab is inside it.
  const readCard = () => {
    const el = document.getElementById('end-card');
    if (!el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };

  const leave = (kind: Leave) => {
    if (snapshot && !saved) {
      setConfirmLeave(kind);
      return;
    }
    go(kind);
  };

  return (
    <main id="main" className={`end ${snapshot ? 'has-card' : ''}`}>
      <div className="end__scene">
        <LampScene lit={false} phone />
      </div>

      <div className="end__content">
        <h1 ref={headingRef} tabIndex={-1} className="end__title">
          今晚先停在这里。
        </h1>
        {/* One device fact, one release. The late-result guarantee is the backend's job, not a sentence here. */}
        <p className="end__lede">麦克风和声音都停了。没有问卷，也没有要做的下一步。</p>

        {snapshot ? (
          // A claim ticket for what is still on the table: found before the ways out, never instead of them.
          <section className={`end-desk ${saved ? 'is-saved' : ''}`} aria-labelledby="end-desk-h">
            <span className="end-desk__stub" aria-hidden="true">
              {CARD_TYPE_LABEL[snapshot.card.type]}
            </span>
            <div className="end-desk__body">
              <h2 id="end-desk-h" className="end-desk__h">
                {saved ? '这张已经留下了' : '这张卡片还在桌上'}
              </h2>
              <p className="end-desk__title">{snapshot.card.title}</p>
              <p className="end-desk__note">
                {saved ? '在这台设备的这个浏览器里，“以前留下的”能找到它。' : '关掉或刷新页面，它就没有了。'}
              </p>
              <div className="end-desk__row">
                {!saved && (
                  <button type="button" className="btn btn--primary" onClick={() => setSaveOpen(true)}>
                    <HardDrive aria-hidden="true" /> 留下这张…
                  </button>
                )}
                <button type="button" className="btn btn--ghost end-desk__read" aria-controls="end-card" onClick={readCard}>
                  读一遍全文 <ArrowDown aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
        ) : (
          <p className="end__none">这次没有要留下的东西。这也是一种好好结束。</p>
        )}

        <div className="end__actions" ref={actionsRef} role="group" aria-label="接下来">
          {confirmLeave ? (
            <div className="inline-confirm end-confirm" role="group" aria-label="确认清掉这张卡片" aria-describedby="end-confirm-msg">
              <p id="end-confirm-msg" ref={confirmRef} tabIndex={-1} className="end-confirm__msg">
                这张卡片还没留下。{confirmLeave === 'reset' ? '回到开始' : '重新开始'}后，它会从页面上消失。
              </p>
              <div className="row gap-s wrap">
                <button type="button" className="btn btn--primary" onClick={() => setSaveOpen(true)}>
                  先留下它
                </button>
                <button type="button" className="btn btn--danger" onClick={() => go(confirmLeave)}>
                  不用了，清掉
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => {
                    backTo.current = confirmLeave;
                    setConfirmLeave(null);
                  }}
                >
                  再想想
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" className="btn btn--quiet" data-leave="again" onClick={() => leave('again')}>
                <MessageCircle aria-hidden="true" /> 再说一会儿
              </button>
              <button type="button" className="btn btn--ghost" data-leave="call" onClick={() => leave('call')}>
                <PhoneGlyph /> 打个电话
              </button>
              <button type="button" className="btn btn--ghost" data-leave="reset" onClick={() => leave('reset')}>
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

        {snapshot && (
          <section id="end-card" className="end__card" aria-labelledby="end-card-h" tabIndex={-1}>
            <h2 id="end-card-h" className="end__sub">
              整张卡片
            </h2>
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
        )}
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
