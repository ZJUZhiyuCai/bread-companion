'use client';

import { useEffect, useRef } from 'react';
import { BookmarkPlus, ScanText, X } from 'lucide-react';
import type { Card } from '@/domain/types';
import { CardView } from './CardView';
import { FindingsSection } from './Findings';
import { SourcesSection } from './Sources';
import { useDomId } from './hooks';
import type { EvidenceContext } from './labels';
import type { AssistMode, BreadVM } from './vm';

export type TraySection = 'card' | 'findings' | 'sources';

interface WorkPanelProps {
  vm: BreadVM;
  /** 'aside' sits beside the conversation on wide screens; 'sheet' is rendered inside a bottom-sheet dialog. */
  variant: 'aside' | 'sheet';
  /** Bump `n` to scroll to and focus a section. */
  target: { section: TraySection; n: number };
  cardSaved: boolean;
  /** Non-zero asks the card to open its editor; reset through onEditConsumed. */
  editToken: number;
  onEditConsumed: () => void;
  highlightSource: string | null;
  onClose: () => void;
  onOpenSource: (id: string) => void;
  onRequestSave: () => void;
  onRedo: (card: Card, direction?: string) => void;
  onPractice: (question: string) => void;
  onAssist: (mode: AssistMode) => void;
  onAddMaterial: () => void;
}

/** The table: what's been put down tonight. One calm scroll instead of tabs. */
export function WorkPanel(props: WorkPanelProps) {
  const { vm, variant, target, cardSaved, editToken, onEditConsumed, highlightSource, onClose, onOpenSource, onRequestSave, onRedo, onPractice, onAssist, onAddMaterial } =
    props;
  const { state, currentCard, capabilities, busy } = vm;
  const id = useDomId('tray');
  const canAct = state.lifecycle === 'active';
  const ctx: EvidenceContext = { sources: state.sources, snapshot: null };
  const refs = useRef<Record<TraySection, HTMLHeadingElement | null>>({ card: null, findings: null, sources: null });

  useEffect(() => {
    if (target.n === 0) return;
    // A highlighted source takes focus itself.
    if (target.section === 'sources' && highlightSource) return;
    const el = refs.current[target.section];
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.n]);

  const showFindings = state.findings.length > 0;

  const body = (
    <>
      <section className="tray__section" aria-labelledby={`${id}-card`}>
        <h3
          id={`${id}-card`}
          className="tray__h"
          tabIndex={-1}
          ref={(el) => {
            refs.current.card = el;
          }}
        >
          卡片
        </h3>
        {currentCard ? (
          <CardView
            card={currentCard}
            findings={state.findings}
            ctx={ctx}
            busy={busy}
            saved={cardSaved}
            editToken={editToken}
            onEditConsumed={onEditConsumed}
            onEdit={vm.editCard}
            onRequestSave={onRequestSave}
            onExport={vm.exportCard}
            onRedo={(direction) => onRedo(currentCard, direction)}
            onOpenSource={onOpenSource}
          />
        ) : (
          <div className="tray-empty tray-empty--card">
            <span className="tray-empty__tag" aria-hidden="true" />
            <p>还没有卡片。想留的时候，面包会用你说过的话起个草稿，你来改。可以只有一行，也可以什么都不留。</p>
            {canAct && (
              <div className="row gap-s wrap">
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => onAssist('organize')} disabled={busy}>
                  <BookmarkPlus aria-hidden="true" /> 留个记号
                </button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => onAssist('review')} disabled={busy}>
                  <ScanText aria-hidden="true" /> 看看那段回答
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {showFindings && (
        <section className="tray__section" aria-labelledby={`${id}-fd`}>
          <h3
            id={`${id}-fd`}
            className="tray__h"
            tabIndex={-1}
            ref={(el) => {
              refs.current.findings = el;
            }}
          >
            面包看到的
            <span className="tray__hint">分开放：你说过的、可能的解释、还不知道的</span>
          </h3>
          <FindingsSection
            findings={state.findings}
            ctx={ctx}
            canAct={canAct}
            onReject={vm.rejectFinding}
            onPractice={onPractice}
            onOpenSource={onOpenSource}
          />
        </section>
      )}

      <section className="tray__section" aria-labelledby={`${id}-src`}>
        <h3
          id={`${id}-src`}
          className="tray__h"
          tabIndex={-1}
          ref={(el) => {
            refs.current.sources = el;
          }}
        >
          你放进来的材料
        </h3>
        <SourcesSection
          sources={state.sources}
          canAct={canAct}
          maxChars={capabilities?.limits.maxSourceChars ?? null}
          highlightId={highlightSource}
          onAdd={onAddMaterial}
          onCorrect={vm.correctSource}
          onConfirm={vm.confirmSource}
        />
      </section>
    </>
  );

  if (variant === 'sheet') return <div className="tray tray--sheet">{body}</div>;

  return (
    <aside className="tray tray--aside" aria-labelledby={`${id}-title`}>
      <header className="tray__head">
        <div>
          <h2 id={`${id}-title`} className="tray__title">
            今晚的卡片与材料
          </h2>
          <p className="tray__sub">只在这次对话里。你选“留下”的，才会存到这台设备。</p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="收起卡片与材料">
          <X aria-hidden="true" />
        </button>
      </header>
      {/* focusable so keyboard users can scroll it */}
      <div className="tray__body" tabIndex={0}>
        {body}
      </div>
    </aside>
  );
}
