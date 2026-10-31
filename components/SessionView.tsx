'use client';

import { useEffect, useRef, useState } from 'react';
import type { Card } from '@/domain/types';
import { Composer } from './Composer';
import { Conversation } from './Conversation';
import { Dialog } from './Dialog';
import { ModeBar } from './ModeBar';
import { PracticeAdjust } from './PracticeSetup';
import { SavePreview } from './SavePreview';
import { MaterialDialog } from './Sources';
import { TopBar } from './TopBar';
import { WorkPanel, type TraySection } from './WorkPanel';
import { anyDialogOpen, useMediaQuery } from './hooks';
import {
  ACTIVITY_META,
  CARD_TYPE_LABEL,
  STOP_BEFORE_MODAL,
  WORKING_STATES,
  cardEvidence,
  isCardSaved,
  isLocked,
  type EvidenceView,
} from './labels';
import type { AssistMode, BreadVM } from './vm';

export type EntryIntent = 'talk' | 'welcome' | 'review' | 'resume' | null;

interface SessionViewProps {
  vm: BreadVM;
  intent: EntryIntent;
  onOpenArchive: () => void;
  onOpenAbout: () => void;
}

export function SessionView({ vm, intent, onOpenArchive, onOpenAbout }: SessionViewProps) {
  const { state, currentCard, capabilities: caps, busy } = vm;
  const isDesktop = useMediaQuery('(min-width: 1080px)');
  const canAct = state.lifecycle === 'active';
  const activity = state.activity;
  const working = WORKING_STATES.includes(activity);
  const thinking = activity === 'generating' || activity === 'validating';

  const [trayOpen, setTrayOpen] = useState(false);
  const [trayTarget, setTrayTarget] = useState<{ section: TraySection; n: number }>({ section: 'card', n: 0 });
  const [highlightSource, setHighlightSource] = useState<string | null>(null);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [materialPrefill, setMaterialPrefill] = useState('');
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  // The exact version the user is looking at in the save preview.
  const [saveSnap, setSaveSnap] = useState<{ card: Card; evidence: EvidenceView[] } | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [speakPendingId, setSpeakPendingId] = useState<string | null>(null);
  const [live, setLive] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const vmRef = useRef(vm);
  vmRef.current = vm;

  const cardSaved = isCardSaved(currentCard, vm.savedCases);
  const hasTalked = state.messages.some((m) => m.role === 'user') || state.sources.length > 0 || state.mode !== 'listen';

  // Typing intent gets the keyboard; the listen-first intent does not (no surprise keyboard on phones).
  useEffect(() => {
    if (intent === 'welcome') headingRef.current?.focus();
    else textareaRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc = stop, unless a dialog handled it first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || anyDialogOpen()) return;
      if (vmRef.current.state.lifecycle !== 'active') return;
      vmRef.current.stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Quiet announcements: what the loaf is doing, a new card, a new piece of material.
  useEffect(() => {
    if (activity !== 'idle') setLive(`面包${ACTIVITY_META[activity].label}`);
  }, [activity]);

  const cardKey = currentCard ? `${currentCard.id}:${currentCard.revision}:${currentCard.validity}` : null;
  useEffect(() => {
    if (!currentCard) return;
    setLive(
      isLocked(currentCard.validity)
        ? `这张${CARD_TYPE_LABEL[currentCard.type]}需要重新整理`
        : `桌上有一张${CARD_TYPE_LABEL[currentCard.type]}：${currentCard.title}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardKey]);

  // Announce a pasted material only once it actually appears in state, and only for the user's own paste.
  const sourceCount = state.sources.length;
  const lastSourceCount = useRef(sourceCount);
  const awaitingMaterial = useRef(false);
  useEffect(() => {
    if (awaitingMaterial.current && sourceCount > lastSourceCount.current) {
      awaitingMaterial.current = false;
      setLive('材料放进来了，在“卡片与材料”里能看到');
    }
    lastSourceCount.current = sourceCount;
  }, [sourceCount]);

  useEffect(() => {
    if (activity !== 'speaking' && !speakPendingId) setSpeakingId(null);
  }, [activity, speakPendingId]);

  useEffect(() => {
    if (!highlightSource) return;
    const t = window.setTimeout(() => setHighlightSource(null), 2600);
    return () => window.clearTimeout(t);
  }, [highlightSource]);

  // Modal surfaces make 停止 unreachable; don't leave a mic or audio running behind them.
  const settle = () => {
    if (STOP_BEFORE_MODAL.includes(activity)) vm.stop();
  };

  const openTray = (section: TraySection) => {
    if (!isDesktop) settle();
    setTrayTarget((t) => ({ section, n: t.n + 1 }));
    setTrayOpen(true);
  };

  const closeTray = () => {
    setTrayOpen(false);
    if (!isDesktop) window.setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 0);
  };

  const focusComposer = () => window.setTimeout(() => textareaRef.current?.focus(), 0);

  const send = () => {
    const t = draft.trim();
    const max = caps?.limits.maxInputChars ?? null;
    if (!t || busy || !canAct || (max !== null && t.length > max)) return;
    setDraft('');
    void vm.send(t);
  };

  const assist = (mode: AssistMode) => {
    if (!canAct || busy) return;
    void vm.assist(mode);
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

  const materialFromDraft = useRef(false);
  const openMaterial = (prefill = '', fromDraft = false) => {
    settle();
    materialFromDraft.current = fromDraft;
    setMaterialPrefill(prefill);
    setMaterialOpen(true);
  };

  const openSource = (id: string) => {
    openTray('sources');
    setHighlightSource(id);
  };

  const freeze = (card: Card) => ({
    card,
    evidence: cardEvidence(card, state.findings, { sources: state.sources, snapshot: null }),
  });

  const requestSave = () => {
    if (!currentCard || isLocked(currentCard.validity)) return;
    settle();
    setSaveSnap(freeze(currentCard));
    setSaveOpen(true);
  };

  const redo = (card: Card) => {
    if (!isDesktop) setTrayOpen(false);
    assist(card.type === 'note' ? 'organize' : 'review');
  };

  const practiceThis = (question: string) => {
    if (!canAct) return;
    vm.setPractice(question, []);
    if (!isDesktop) setTrayOpen(false);
    focusComposer();
  };

  const [editToken, setEditToken] = useState(0);
  const editFromPreview = () => {
    setSaveOpen(false);
    openTray('card');
    setEditToken((n) => n + 1);
  };

  const tray = (
    <WorkPanel
      vm={vm}
      variant={isDesktop ? 'aside' : 'sheet'}
      target={trayTarget}
      cardSaved={cardSaved}
      editToken={editToken}
      onEditConsumed={() => setEditToken(0)}
      highlightSource={highlightSource}
      onClose={closeTray}
      onOpenSource={openSource}
      onRequestSave={requestSave}
      onRedo={redo}
      onPractice={practiceThis}
      onAssist={(m) => {
        if (!isDesktop) setTrayOpen(false);
        assist(m);
      }}
      onAddMaterial={() => openMaterial()}
    />
  );

  return (
    <div
      className={`session ${trayOpen && isDesktop ? 'has-tray' : ''}`}
      data-activity={activity}
      data-mode={state.mode}
    >
      <TopBar
        caps={caps}
        activity={activity}
        active={canAct}
        working={working}
        trayOpen={trayOpen}
        trayCount={sourceCount + (currentCard ? 1 : 0)}
        cardWaiting={!!currentCard && !cardSaved && !isLocked(currentCard.validity)}
        onToggleTray={() => (trayOpen ? closeTray() : openTray(currentCard ? 'card' : sourceCount ? 'sources' : 'card'))}
        onOpenArchive={onOpenArchive}
        onOpenAbout={onOpenAbout}
        onStop={vm.stop}
        onEnd={vm.end}
      />

      <div className="session__body">
        <main id="main" className="stage" aria-labelledby="conv-heading">
          <h1 id="conv-heading" ref={headingRef} tabIndex={-1} className="sr-only">
            和面包说说话
          </h1>

          <Conversation
            messages={state.messages}
            welcomeIntent={intent === 'welcome'}
            reviewIntent={intent === 'review'}
            supportGuidance={state.supportState === 'support_guidance'}
            thinking={thinking}
            ttsAvailable={caps ? caps.tts.available : null}
            ttsReason={caps?.tts.reason}
            canPlay={!!caps?.tts.available && canAct}
            speakingId={speakingId}
            speakPendingId={speakPendingId}
            isSpeaking={activity === 'speaking'}
            onSpeak={onSpeak}
            onStop={vm.stop}
            onOpenSource={openSource}
            card={currentCard}
            cardSaved={cardSaved}
            onOpenCard={() => openTray('card')}
            onSaveCard={requestSave}
            onRedoCard={redo}
            busy={busy}
            canAct={canAct}
          />

          <div className="dock">
            <ModeBar
              mode={state.mode}
              selectedQuestion={state.selectedQuestion}
              practiceCriteria={state.practiceCriteria}
              canAct={canAct}
              busy={busy}
              show={hasTalked && !['requesting_mic', 'recording', 'recorded', 'transcribing'].includes(activity) && !vm.transcriptDraft}
              hasCard={!!currentCard}
              onAssist={assist}
              onBackToTalk={() => vm.setMode('listen')}
              onAdjustPractice={() => {
                settle();
                setAdjustOpen(true);
              }}
            />
            <Composer
              vm={vm}
              draft={draft}
              setDraft={setDraft}
              onSend={send}
              textareaRef={textareaRef}
              onAddMaterial={openMaterial}
              sourceCount={sourceCount}
              onOpenSources={() => openTray('sources')}
            />
          </div>
        </main>

        {isDesktop && trayOpen && tray}
      </div>

      {!isDesktop && (
        <Dialog
          open={trayOpen}
          onClose={closeTray}
          variant="sheet"
          size="lg"
          className="tray-sheet"
          title="今晚的卡片与材料"
          subtitle="只在这次对话里。你选“留下”的，才会存到这台设备。"
          closeLabel="收起"
        >
          {trayOpen && tray}
        </Dialog>
      )}

      <MaterialDialog
        open={materialOpen}
        onClose={() => {
          setMaterialOpen(false);
          focusComposer();
        }}
        prefill={materialPrefill}
        error={vm.error}
        maxChars={caps?.limits.maxSourceChars ?? null}
        canAct={canAct}
        onAdd={(text) => {
          awaitingMaterial.current = true;
          if (!vm.addMaterial(text)) { awaitingMaterial.current = false; return; }
          // A long paste moved over from the composer shouldn't also stay there waiting to be sent.
          if (materialFromDraft.current) setDraft('');
          materialFromDraft.current = false;
          setMaterialOpen(false);
          focusComposer();
        }}
      />

      <PracticeAdjust
        open={adjustOpen}
        onClose={() => {
          setAdjustOpen(false);
          focusComposer();
        }}
        question={state.selectedQuestion}
        criteria={state.practiceCriteria}
        busy={busy}
        onApply={(q, c) => {
          vm.setPractice(q, c);
          setAdjustOpen(false);
          focusComposer();
        }}
        onAnother={() => {
          setAdjustOpen(false);
          assist('practice');
        }}
      />

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
          savedCases={vm.savedCases}
          clearNotice={vm.clearNotice}
          onSave={vm.saveCard}
          onExport={vm.exportCard}
          onEdit={editFromPreview}
          onRefresh={() => currentCard && setSaveSnap(freeze(currentCard))}
        />
      )}

      <p className="sr-only" aria-live="polite">
        {live}
      </p>
    </div>
  );
}
