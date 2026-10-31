'use client';

import { useEffect, useRef, useState } from 'react';
import type { SavedCase } from '@/domain/types';
import { useBread } from '@/services/use-bread';
import { EndView } from './EndView';
import { EntryScreen } from './EntryScreen';
import { Notices } from './Notices';
import { SavedArchive } from './SavedArchive';
import { AboutSheet, type TextSize } from './ServiceStatus';
import { SessionView, type EntryIntent } from './SessionView';
import { STOP_BEFORE_MODAL } from './labels';
import type { BreadVM } from './vm';

export default function BreadApp() {
  const vm = useBread() as BreadVM;
  const { state } = vm;
  const [intent, setIntent] = useState<EntryIntent>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [textSize, setTextSize] = useState<TextSize>('m');
  const pendingFirst = useRef<string | null>(null);
  const pendingReview = useRef(false);
  const vmRef = useRef(vm);
  vmRef.current = vm;

  useEffect(() => {
    document.documentElement.dataset.textSize = textSize;
  }, [textSize]);

  // The archive count on the entry screen. Read-only.
  useEffect(() => {
    void vmRef.current.refreshSaved();
  }, []);

  // Whatever the user chose on the entry screen runs once the session has actually started.
  useEffect(() => {
    if (!state.started || state.lifecycle !== 'active') return;
    const first = pendingFirst.current;
    if (first) {
      pendingFirst.current = null;
      void vmRef.current.send(first);
    } else if (pendingReview.current) {
      pendingReview.current = false;
      void vmRef.current.assist('review');
    }
  }, [state.started, state.lifecycle, state.sessionId]);

  const talk = (first?: string) => {
    if (state.lifecycle === 'ended') vm.reset();
    setIntent('talk');
    if (first) pendingFirst.current = first;
    vm.start('listen');
  };

  const review = () => {
    setIntent('review');
    pendingReview.current = true;
    vm.start('review');
  };

  const resume = (saved: SavedCase) => {
    setIntent('resume');
    vm.resumeSaved(saved);
  };

  const reset = () => {
    setIntent(null);
    vm.reset();
  };

  const ended = state.lifecycle === 'ended';
  const sessionLive = state.started && !ended;

  const settleBeforeModal = () => {
    if (sessionLive && STOP_BEFORE_MODAL.includes(state.activity)) vm.stop();
  };
  const openArchive = () => {
    settleBeforeModal();
    setArchiveOpen(true);
  };
  const openAbout = () => {
    settleBeforeModal();
    setAboutOpen(true);
  };

  return (
    <>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>

      {ended ? (
        <EndView vm={vm} onOpenArchive={openArchive} onReset={reset} onAgain={() => talk()} />
      ) : !state.started ? (
        <EntryScreen
          caps={vm.capabilities}
          savedCount={vm.savedCases.length}
          onTalk={talk}
          onWelcome={() => {
            setIntent('welcome');
            vm.start('listen', true);
          }}
          onReview={review}
          onOpenArchive={openArchive}
          onOpenAbout={openAbout}
        />
      ) : (
        <SessionView key={state.sessionId} vm={vm} intent={intent} onOpenArchive={openArchive} onOpenAbout={openAbout} />
      )}

      <SavedArchive
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        savedCases={vm.savedCases}
        sessionLive={sessionLive && state.messages.length > 0}
        refreshSaved={vm.refreshSaved}
        deleteSaved={vm.deleteSaved}
        importSaved={vm.importSaved}
        onResume={resume}
        onTalkElse={() => {
          if (!sessionLive) talk();
        }}
        notice={vm.notice}
        error={vm.error}
      />

      <AboutSheet open={aboutOpen} onClose={() => setAboutOpen(false)} caps={vm.capabilities} textSize={textSize} setTextSize={setTextSize} />

      <Notices notice={vm.notice} error={vm.error} clearNotice={vm.clearNotice} />
    </>
  );
}
