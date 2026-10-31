'use client';

import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import type { Capabilities } from '@/domain/types';
import { BreadBuddy, type BuddyState } from './BreadBuddy';
import { LampScene } from './NightWindow';
import { BUDDY_LINE, CALL_PREFACE, callBlockReason } from './call';
import { useDomId } from './hooks';

interface CallLauncherProps {
  caps: Capabilities | null;
  onCall: () => void;
  variant: 'hero' | 'panel' | 'pill';
  /** A reason from the page itself, e.g. a recording that has to finish first. */
  blocked?: string;
}

/**
 * The phone. "打电话" needs no manual on the page, so how a call works is the button's own
 * description rather than a paragraph under it. When a call can't happen the button stays in place,
 * says why, and points back to typing — it never fakes a connection.
 */
export function CallLauncher({ caps, onCall, variant, blocked = '' }: CallLauncherProps) {
  const id = useDomId('call');
  const block = blocked || callBlockReason(caps);
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (!hint) return;
    const t = window.setTimeout(() => setHint(''), 6000);
    return () => window.clearTimeout(t);
  }, [hint]);

  useEffect(() => {
    if (!block) setHint('');
  }, [block]);

  const press = () => {
    if (block) {
      setHint(block);
      return;
    }
    onCall();
  };

  if (variant === 'pill') {
    return (
      <>
        <button
          type="button"
          className={`call-pill ${block ? 'is-blocked' : ''}`}
          onClick={press}
          aria-disabled={!!block || undefined}
          aria-describedby={`${id}-pre`}
        >
          <Phone aria-hidden="true" />
          打电话
        </button>
        <span id={`${id}-pre`} className="sr-only">
          {block || CALL_PREFACE}
        </span>
        <p className="call-pill__hint" role="status">
          {hint}
        </p>
      </>
    );
  }

  return (
    <div className={`call-launch call-launch--${variant} ${block ? 'is-blocked' : ''}`}>
      <button
        type="button"
        className="call-launch__btn"
        onClick={press}
        aria-disabled={!!block || undefined}
        aria-describedby={`${id}-pre`}
      >
        <span className="call-launch__ring" aria-hidden="true">
          <Phone aria-hidden="true" />
        </span>
        <span className="call-launch__text">
          <span className="call-launch__title">给面包打个电话</span>
          <span className="call-launch__sub">{block || '用说的，不用打字'}</span>
        </span>
      </button>
      <span id={`${id}-pre`} className="sr-only">
        {block || CALL_PREFACE}
      </span>
      <p className="sr-only" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}

interface CompanionProps {
  buddy: BuddyState;
  /** Short status in plain words, for the label under the figure. */
  status: string;
  caps: Capabilities | null;
  onCall: () => void;
  callBlocked: string;
}

/** Desktop: 面包's corner. The figure under the lamp follows the real state; the phone sits right below it. */
export function CompanionPanel({ buddy, status, caps, onCall, callBlocked }: CompanionProps) {
  return (
    <aside className="companion" aria-label="面包">
      <div className="companion__figure">
        <p key={BUDDY_LINE[buddy]} className="companion__bubble" data-state={buddy}>
          {BUDDY_LINE[buddy]}
        </p>
        <LampScene state={buddy} idPrefix="companion-lamp" className="companion__scene" />
      </div>
      <p className="companion__status">
        <span className="companion__name">面包</span>
        <span className="companion__dot" data-state={buddy} aria-hidden="true" />
        {status}
      </p>
      {/* Identity and the data rules live behind the AI stamp in the top bar, not in this corner. */}
      <CallLauncher variant="panel" caps={caps} onCall={onCall} blocked={callBlocked} />
    </aside>
  );
}

/** Phones: a slim perch under the top bar — the loaf, one line from it, and the phone. */
export function CompanionPerch({ buddy, status, caps, onCall, callBlocked }: CompanionProps) {
  return (
    <div className="perch" data-state={buddy}>
      <span className="perch__buddy">
        <BreadBuddy state={buddy} decorative />
      </span>
      <p className="perch__line">
        <span className="perch__name">面包</span>
        <span className="perch__say">{BUDDY_LINE[buddy]}</span>
        <span className="sr-only">（{status}）</span>
      </p>
      <CallLauncher variant="pill" caps={caps} onCall={onCall} blocked={callBlocked} />
    </div>
  );
}
