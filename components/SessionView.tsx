'use client';

import { useEffect, useRef, useState } from 'react';
import { HeartHandshake, Target } from 'lucide-react';
import type { Card, Mode } from '@/domain/types';
import type { BreadViewModel } from '@/domain/view-model';
import { Composer } from './Composer';
import { Conversation } from './Conversation';
import { ModeBar } from './ModeBar';
import { SavePreview } from './SavePreview';
import { TopBar } from './TopBar';
import { WorkPanel, type PanelTab } from './WorkPanel';
import { anyDialogOpen, useMediaQuery } from './hooks';
import { ACTIVITY_META, CARD_TYPE_LABEL, MODE_META, cardEvidence, type EvidenceView } from './labels';

export type EntryIntent = 'talk' | 'welcome' | 'review' | 'resume' | null;

interface SessionViewProps {
  vm: BreadViewModel;
  intent: EntryIntent;
  onOpenArchive: () => void;
  onOpenStatus: () => void;
}

const REVIEW_PROMPT = '请根据我提供的材料做一次复盘。';

export function SessionView({ vm, intent, onOpenArchive, onOpenStatus }: SessionViewProps) {
  const { state, currentCard, capabilities: caps, busy } = vm;
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const canAct = state.lifecycle === 'active';

  const [panelOpen, setPanelOpen] = useState(intent === 'review');
  const [panelTab, setPanelTab] = useState<PanelTab>(intent === 'review' ? 'material' : 'card');
  const [panelFocus, setPanelFocus] = useState(0);
  const [sourceFormOpen, setSourceFormOpen] = useState(intent === 'review');
  const [highlightSource, setHighlightSource] = useState<string | null>(null);
  const [practicePrefill, setPracticePrefill] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  // The exact version the user is looking at in the save preview.
  const [saveSnap, setSaveSnap] = useState<{ card: Card; evidence: EvidenceView[] } | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [speakPendingId, setSpeakPendingId] = useState<string | null>(null);
  const [live, setLive] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingAfterMode = useRef<{ mode: Mode; text: string } | null>(null);
  const vmRef = useRef(vm);
  vmRef.current = vm;

  const activity = state.activity;
  const thinking = activity === 'generating' || activity === 'validating';
  const ttsAvailable = caps ? caps.tts.available : null;
  const maxInput = caps?.limits.maxInputChars ?? null;

  // Initial focus according to how the user came in. Typing intent gets the keyboard; listening intent does not.
  useEffect(() => {
    if (intent === 'talk' || intent === 'resume') textareaRef.current?.focus();
    else if (intent !== 'review') headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc = stop, unless a dialog or the mobile sheet handled it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || anyDialogOpen()) return;
      if (vmRef.current.state.lifecycle !== 'active') return;
      vmRef.current.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A pending send waits until the requested mode is actually set.
  useEffect(() => {
    const p = pendingAfterMode.current;
    if (p && state.mode === p.mode && state.lifecycle === 'active') {
      pendingAfterMode.current = null;
      void vmRef.current.send(p.text);
    }
  }, [state.mode, state.lifecycle]);

  // New card or new revision: open the panel on desktop (without stealing focus), announce everywhere.
  const cardKey = currentCard ? `${currentCard.id}:${currentCard.revision}:${currentCard.validity}` : null;
  const lastCardId = useRef<string | null>(null);
  useEffect(() => {
    if (!currentCard) return;
    const isNew = lastCardId.current !== currentCard.id;
    lastCardId.current = currentCard.id;
    setLive(`${CARD_TYPE_LABEL[currentCard.type]}第 ${currentCard.revision} 版，${currentCard.validity === 'confirmed' ? '已确认' : currentCard.validity === 'draft' ? '草稿' : '需要重新确认'}`);
    if (isNew && isDesktop && !panelOpen) {
      setPanelTab('card');
      setPanelOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  useEffect(() => {
    setLive(ACTIVITY_META[activity].label);
  }, [activity]);

  useEffect(() => {
    if (activity !== 'speaking' && !speakPendingId) setSpeakingId(null);
  }, [activity, speakPendingId]);

  useEffect(() => {
    if (!highlightSource) return;
    const t = window.setTimeout(() => setHighlightSource(null), 2600);
    return () => window.clearTimeout(t);
  }, [highlightSource]);

  /** focus=false when something inside the panel takes focus itself (source form, highlighted source). */
  const openPanel = (tab: PanelTab, focus = true) => {
    setPanelTab(tab);
    setPanelOpen(true);
    if (focus) setPanelFocus((n) => n + 1);
  };

  const closePanel = () => {
    setPanelOpen(false);
    setSourceFormOpen(false);
    if (!isDesktop) textareaRef.current?.focus({ preventScroll: true });
  };

  const send = () => {
    const t = draft.trim();
    if (!t || busy || (maxInput !== null && t.length > maxInput)) return;
    setDraft('');
    void vm.send(t);
  };

  const startReview = () => {
    const t = draft.trim();
    if (maxInput !== null && t.length > maxInput) return;
    setDraft('');
    void vm.send(t || REVIEW_PROMPT);
  };

  const onMode = (m: Mode) => {
    if (m === 'practice') {
      openPanel('practice');
      return;
    }
    vm.setMode(m);
    if (m === 'organize' && isDesktop) openPanel('card', false);
    if (m === 'review' && isDesktop) openPanel('material', false);
  };

  const redo = () => {
    if (!currentCard) return;
    if (currentCard.type === 'note') {
      if (state.mode !== 'organize') vm.setMode('organize');
      else void vm.send('请按修正后的内容重新整理记号。');
    } else {
      const text = '请按修正后的材料重新复盘。';
      if (state.mode !== 'review') {
        pendingAfterMode.current = { mode: 'review', text };
        vm.setMode('review');
      } else void vm.send(text);
    }
  };

  const onSpeak = async (id: string, text: string) => {
    setSpeakingId(id);
    setSpeakPendingId(id);
    try {
      await vm.speak(text);
    } finally {
      setSpeakPendingId(null);
    }
  };

  const addSource = () => {
    setSourceFormOpen(true);
    openPanel('material', false);
  };

  const openSource = (id: string) => {
    openPanel('material', false);
    setHighlightSource(id);
  };

  const answer = () => {
    if (!isDesktop) setPanelOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const pendingSources = state.sources.filter((s) => !s.confirmed).length;
  const cardVisibleInPanel = panelOpen && panelTab === 'card';
  const placeholder = MODE_META[state.mode].placeholder;

  return (
    <div className={`session ${panelOpen ? 'has-panel' : ''}`} data-activity={activity} data-mode={state.mode}>
      <TopBar
        avatarState={activity}
        mode={state.mode}
        caps={caps}
        active={canAct}
        panelOpen={panelOpen}
        cardFlag={!!currentCard && !cardVisibleInPanel}
        onTogglePanel={() => (panelOpen ? closePanel() : openPanel(currentCard ? 'card' : panelTab))}
        onOpenArchive={onOpenArchive}
        onOpenStatus={onOpenStatus}
        onStop={vm.stop}
        onEnd={vm.end}
      />

      <div className="session__body">
        <main id="main" className="session__main" aria-labelledby="conv-heading">
          <h1 id="conv-heading" ref={headingRef} tabIndex={-1} className="sr-only">
            和面包的对话
          </h1>

          <ModeBar
            mode={state.mode}
            canAct={canAct}
            busy={busy}
            sourceCount={state.sources.length}
            pendingSources={pendingSources}
            selectedQuestion={state.selectedQuestion}
            onMode={onMode}
            onStartReview={startReview}
            onAddSource={addSource}
            onOpenPractice={() => openPanel('practice')}
          />

          {state.supportState === 'support_guidance' && (
            <section className="support" aria-labelledby="support-h">
              <HeartHandshake aria-hidden="true" className="support__icon" />
              <div>
                <h2 id="support-h" className="support__title">先把面试放一放。</h2>
                <p>
                  如果你现在可能伤害自己，请先联系一位你信任的人陪着你。若危险迫在眼前，请联系当地急救或紧急服务。
                </p>
                <p className="small muted">
                  面包是一个程序，不能代替真人或专业帮助，也不会替你联系任何人。停止、结束随时可用。
                </p>
              </div>
            </section>
          )}

          <Conversation
            messages={state.messages}
            mode={state.mode}
            avatarState={activity}
            thinking={thinking}
            welcomeIntent={intent === 'welcome'}
            ttsAvailable={ttsAvailable}
            ttsReason={caps?.tts.reason}
            canPlay={!!ttsAvailable && canAct}
            speakingId={speakingId}
            speakPendingId={speakPendingId}
            isSpeaking={activity === 'speaking'}
            onSpeak={onSpeak}
            onStop={vm.stop}
            onOpenSource={openSource}
            card={currentCard}
            showCardSlip={!!currentCard && !cardVisibleInPanel}
            onOpenCard={() => openPanel('card')}
          />

          <div className="session__dock">
            {state.mode === 'practice' && state.selectedQuestion && (
              <button type="button" className="practice-strip" onClick={() => openPanel('practice')}>
                <Target aria-hidden="true" />
                <span className="practice-strip__q">
                  <span className="sr-only">正在练：</span>
                  {state.selectedQuestion}
                </span>
                {state.practiceCriteria.length > 0 && (
                  <span className="practice-strip__c">关注：{state.practiceCriteria.join('、')}</span>
                )}
              </button>
            )}
            <Composer
              vm={vm}
              draft={draft}
              setDraft={setDraft}
              onSend={send}
              placeholder={placeholder}
              textareaRef={textareaRef}
              onAddSource={addSource}
            />
          </div>
        </main>

        {panelOpen && (
          <WorkPanel
            vm={vm}
            variant={isDesktop ? 'aside' : 'sheet'}
            tab={panelTab}
            setTab={setPanelTab}
            onClose={closePanel}
            focusToken={panelFocus}
            sourceFormOpen={sourceFormOpen}
            setSourceFormOpen={setSourceFormOpen}
            highlightSource={highlightSource}
            onOpenSource={openSource}
            practicePrefill={practicePrefill}
            onPracticeFromFinding={(q) => {
              setPracticePrefill(q);
              setPanelTab('practice');
            }}
            onRequestSave={() => {
              if (!currentCard) return;
              if (busy) vm.stop();
              setSaveSnap({
                card: currentCard,
                evidence: cardEvidence(currentCard, state.findings, { sources: state.sources, snapshot: null }),
              });
              setSaveOpen(true);
            }}
            onRedo={redo}
            onAnswer={answer}
            onOrganize={() => vm.setMode('organize')}
          />
        )}
      </div>

      {saveSnap && (
        <SavePreview
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          card={saveSnap.card}
          liveCard={currentCard}
          evidence={saveSnap.evidence}
          practice={[]}
          notice={vm.notice}
          error={vm.error}
          onSave={vm.saveCard}
        />
      )}

      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </div>
  );
}
