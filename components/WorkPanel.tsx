'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { BookmarkPlus, X } from 'lucide-react';
import type { BreadViewModel } from '@/domain/view-model';
import { CardView } from './CardView';
import { FindingsSection } from './Findings';
import { PracticeSetup } from './PracticeSetup';
import { SourcesSection } from './Sources';
import { useDomId } from './hooks';
import type { EvidenceContext } from './labels';

export type PanelTab = 'card' | 'material' | 'practice';

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'card', label: '记号' },
  { key: 'material', label: '材料与依据' },
  { key: 'practice', label: '练一题' },
];

interface WorkPanelProps {
  vm: BreadViewModel;
  variant: 'aside' | 'sheet';
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  onClose: () => void;
  /** Increment to move focus to the panel heading. */
  focusToken: number;
  sourceFormOpen: boolean;
  setSourceFormOpen: (v: boolean) => void;
  highlightSource: string | null;
  onOpenSource: (id: string) => void;
  practicePrefill: string | null;
  onPracticeFromFinding: (q: string) => void;
  onRequestSave: () => void;
  onRedo: () => void;
  onAnswer: () => void;
  onOrganize: () => void;
}

export function WorkPanel(props: WorkPanelProps) {
  const {
    vm,
    variant,
    tab,
    setTab,
    onClose,
    focusToken,
    sourceFormOpen,
    setSourceFormOpen,
    highlightSource,
    onOpenSource,
    practicePrefill,
    onPracticeFromFinding,
    onRequestSave,
    onRedo,
    onAnswer,
    onOrganize,
  } = props;
  const { state, currentCard, capabilities, busy } = vm;
  const id = useDomId('panel');
  const headRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<PanelTab, HTMLButtonElement | null>>({ card: null, material: null, practice: null });
  const canAct = state.lifecycle === 'active';
  const ctx: EvidenceContext = { sources: state.sources, snapshot: null };
  const maxSource = capabilities?.limits.maxSourceChars ?? null;

  useEffect(() => {
    if (focusToken > 0) headRef.current?.focus();
  }, [focusToken]);

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const t = TABS[next].key;
    setTab(t);
    tabRefs.current[t]?.focus();
  };

  const pendingSources = state.sources.filter((s) => !s.confirmed).length;
  const counts: Record<PanelTab, ReactNode> = {
    card: currentCard ? (
      <>
        <span className={`tab-dot tab-dot--${currentCard.validity}`} aria-hidden="true" />
        <span className="sr-only">（有卡片）</span>
      </>
    ) : null,
    material:
      state.sources.length + state.findings.length > 0 ? (
        <span className="tab-count">
          {state.sources.length + state.findings.length}
          {pendingSources > 0 && <span className="sr-only">，{pendingSources} 段待确认</span>}
        </span>
      ) : null,
    practice:
      state.mode === 'practice' && state.selectedQuestion ? (
        <>
          <span className="tab-dot tab-dot--draft" aria-hidden="true" />
          <span className="sr-only">（练习中）</span>
        </>
      ) : null,
  };

  const suggestions = state.findings
    .filter((f) => f.kind === 'practice_suggestion' && f.validity !== 'stale' && f.validity !== 'disputed')
    .map((f) => f.text);

  const Wrapper = variant === 'sheet' ? 'section' : 'aside';

  return (
    <Wrapper
      className={`panel panel--${variant}`}
      aria-labelledby={`${id}-h`}
      {...(variant === 'sheet' ? { role: 'dialog', 'aria-modal': false } : {})}
      onKeyDown={(e) => {
        if (variant === 'sheet' && e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="panel__head">
        <h2 id={`${id}-h`} ref={headRef} tabIndex={-1} className="panel__title">
          今晚的材料
          <span className="panel__sub">只在这次会话里，结束后不会自动保留</span>
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="收起今晚的材料">
          <X aria-hidden="true" />
        </button>
      </header>

      <div role="tablist" aria-label="今晚的材料" className="tabs">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[t.key] = el;
            }}
            role="tab"
            type="button"
            id={`${id}-tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`${id}-pane-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className={`tab ${tab === t.key ? 'is-on' : ''}`}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
            {counts[t.key]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`${id}-pane-${tab}`}
        aria-labelledby={`${id}-tab-${tab}`}
        className="panel__body"
        tabIndex={0}
      >
        {tab === 'card' &&
          (currentCard ? (
            <CardView
              card={currentCard}
              findings={state.findings}
              ctx={ctx}
              busy={busy}
              onEdit={vm.editCard}
              onConfirm={vm.confirmCard}
              onRequestSave={onRequestSave}
              onExport={vm.exportCard}
              onRedo={onRedo}
              onOpenSource={onOpenSource}
            />
          ) : (
            <div className="empty-card">
              <div className="empty-card__tag" aria-hidden="true">
                <span />
              </div>
              <p>还没有卡片。</p>
              <p className="muted small">
                “留个记号”会把你在意的一件事、以后想再看的问题、目前不知道的事整理成一张小卡片。可以只有一条，也可以什么都不留。
              </p>
              {canAct && state.mode !== 'organize' && (
                <button type="button" className="btn btn--quiet" onClick={onOrganize} disabled={busy}>
                  <BookmarkPlus aria-hidden="true" /> 留个记号
                </button>
              )}
              {state.mode === 'organize' && (
                <p className="small">已在“留个记号”模式。先说几句或放一段材料，面包会整理出候选。</p>
              )}
            </div>
          ))}

        {tab === 'material' && (
          <>
            <section className="pane-section" aria-labelledby={`${id}-src`}>
              <h3 id={`${id}-src`} className="pane-section__title">
                材料
              </h3>
              <SourcesSection
                sources={state.sources}
                canAct={canAct}
                maxChars={maxSource}
                formOpen={sourceFormOpen}
                setFormOpen={setSourceFormOpen}
                highlightId={highlightSource}
                onAdd={vm.addSource}
                onCorrect={vm.correctSource}
                onConfirm={vm.confirmSource}
              />
            </section>
            <section className="pane-section" aria-labelledby={`${id}-fd`}>
              <h3 id={`${id}-fd`} className="pane-section__title">
                分析：事实、推断、未知
              </h3>
              <FindingsSection
                findings={state.findings}
                ctx={ctx}
                canAct={canAct}
                onReject={vm.rejectFinding}
                onPractice={onPracticeFromFinding}
                onOpenSource={onOpenSource}
              />
            </section>
          </>
        )}

        {tab === 'practice' && (
          <PracticeSetup
            active={state.mode === 'practice'}
            selectedQuestion={state.selectedQuestion}
            practiceCriteria={state.practiceCriteria}
            suggestions={suggestions}
            prefill={practicePrefill}
            canAct={canAct}
            busy={busy}
            onStart={vm.setPractice}
            onAnswer={onAnswer}
          />
        )}
      </div>
    </Wrapper>
  );
}
