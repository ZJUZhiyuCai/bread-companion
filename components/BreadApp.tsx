'use client';

import { useEffect, useRef, useState } from 'react';
import type { SavedCase } from '@/domain/types';
import { useBread } from '@/services/use-bread';
import { EndView } from './EndView';
import { EntryScreen } from './EntryScreen';
import { Notices } from './Notices';
import { SavedArchive } from './SavedArchive';
import { StatusDialog, type TextSize } from './ServiceStatus';
import { SessionView, type EntryIntent } from './SessionView';

export default function BreadApp() {
  const vm = useBread();
  const { state } = vm;
  const [intent, setIntent] = useState<EntryIntent>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [textSize, setTextSize] = useState<TextSize>('m');
  const pendingFirst = useRef<string | null>(null);
  const vmRef = useRef(vm);
  vmRef.current = vm;

  useEffect(() => {
    document.documentElement.dataset.textSize = textSize;
  }, [textSize]);

  // Load the local archive count for the entry screen. Read-only.
  useEffect(() => {
    void vmRef.current.refreshSaved();
  }, []);

  // The entry box's first sentence is sent once the session has actually started.
  useEffect(() => {
    const t = pendingFirst.current;
    if (t && state.started && state.lifecycle === 'active') {
      pendingFirst.current = null;
      void vmRef.current.send(t);
    }
  }, [state.started, state.lifecycle, state.sessionId]);

  const talk = (first?: string) => {
    if (state.lifecycle === 'ended') vm.reset();
    setIntent('talk');
    if (first) pendingFirst.current = first;
    vm.start('listen');
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
  const openArchive = () => {
    if (vm.busy && sessionLive) vm.stop();
    setArchiveOpen(true);
  };
  const openStatus = () => {
    if (vm.busy && sessionLive) vm.stop();
    setStatusOpen(true);
  };

  return (
    <>
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>

      {ended ? (
        <EndView vm={vm} onOpenArchive={openArchive} onReset={reset} />
      ) : !state.started ? (
        <EntryScreen
          caps={vm.capabilities}
          savedCount={vm.savedCases.length}
          onTalk={talk}
          onWelcome={() => {
            setIntent('welcome');
            vm.start('listen', true);
          }}
          onReview={() => {
            setIntent('review');
            vm.start('review');
          }}
          onOpenArchive={openArchive}
          onOpenStatus={openStatus}
        />
      ) : (
        <SessionView
          key={state.sessionId}
          vm={vm}
          intent={intent}
          onOpenArchive={openArchive}
          onOpenStatus={openStatus}
        />
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

      <StatusDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        caps={vm.capabilities}
        textSize={textSize}
        setTextSize={setTextSize}
      />

      <Notices notice={vm.notice} error={vm.error} clearNotice={vm.clearNotice} />
    </>
  );
}
