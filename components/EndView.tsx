'use client';

import { useEffect, useRef, useState } from 'react';
import { Archive, RotateCcw } from 'lucide-react';
import type { BreadViewModel } from '@/domain/view-model';
import { CardView } from './CardView';
import { NightWindow } from './NightWindow';
import { SavePreview } from './SavePreview';
import { cardEvidence, type EvidenceContext } from './labels';

interface EndViewProps {
  vm: BreadViewModel;
  onOpenArchive: () => void;
  onReset: () => void;
}

/** Reads only state.endSnapshot — sources are already cleared and nothing here talks to a model or plays audio. */
export function EndView({ vm, onOpenArchive, onReset }: EndViewProps) {
  const snapshot = vm.state.endSnapshot;
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const ctx: EvidenceContext = { sources: null, snapshot: snapshot?.evidence ?? [] };
  const evidence = snapshot ? cardEvidence(snapshot.card, snapshot.findings, ctx) : [];

  return (
    <main id="main" className="end">
      <div className="end__scene">
        <NightWindow lit={false} />
      </div>

      <div className="end__content">
        <h1 ref={headingRef} tabIndex={-1} className="end__title">
          今晚先停在这里。
        </h1>
        <p className="end__lede">录音、生成和播放都已经停下，之后到达的结果也不会再出现。没有问卷，也没有下一步任务。</p>

        {snapshot ? (
          <section className="end__card" aria-labelledby="end-card-h">
            <h2 id="end-card-h" className="end__sub">
              这张卡片还在这里
            </h2>
            <p className="small muted">
              它只在这个页面里。关掉或刷新页面，它就会消失；要不要留下、留在哪里，由你决定。
            </p>
            <CardView
              card={snapshot.card}
              findings={snapshot.findings}
              ctx={ctx}
              readOnly
              onRequestSave={() => setSaveOpen(true)}
              onExport={vm.exportCard}
            />
            {snapshot.confirmedPractice.length > 0 && (
              <section className="end__practice" aria-labelledby="end-pr-h">
                <h3 id="end-pr-h" className="pane-section__title">
                  已确认的练习
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
          <p className="end__none">这次没有确认过的卡片，所以什么都不会留下。这也是一种好好结束。</p>
        )}

        <div className="end__actions">
          {confirmReset ? (
            <div className="inline-confirm" role="group" aria-label="确认清空">
              <p className="small">清空后这张只读卡片会从页面上移除。已经保存到本设备或导出的不受影响。</p>
              <div className="row gap-s">
                <button type="button" className="btn btn--primary" onClick={onReset}>
                  清空
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmReset(false)}>
                  先不清空
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => (snapshot ? setConfirmReset(true) : onReset())}
            >
              <RotateCcw aria-hidden="true" /> {snapshot ? '清空，回到开始' : '回到开始'}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onOpenArchive}>
            <Archive aria-hidden="true" /> 本设备档案
          </button>
        </div>
      </div>

      {snapshot && (
        <SavePreview
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          card={snapshot.card}
          liveCard={vm.currentCard ?? snapshot.card}
          evidence={evidence}
          practice={snapshot.confirmedPractice}
          notice={vm.notice}
          error={vm.error}
          onSave={vm.saveCard}
        />
      )}
    </main>
  );
}
