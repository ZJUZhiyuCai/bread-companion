'use client';

import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Capabilities } from '@/domain/types';
import { BreadBuddy, type BuddyState } from './BreadBuddy';
import { LampScene } from './NightWindow';
import { Phone3D } from './Phone3D';
import { PhoneGlyph, RedPhone } from './RedPhone';
import { BUDDY_LINE, CALL_PREFACE, callBlockDetail, callBlockReason } from './call';
import { useDomId } from './hooks';
import { HERO_PHONE } from './phone3d/layouts';
import { usePhone3D } from './phone3d/usePhone3D';

interface CallLauncherProps {
  caps: Capabilities | null;
  onCall: () => void;
  variant: 'hero' | 'panel' | 'pill';
  /** A reason from the page itself, e.g. a recording that has to finish first. */
  blocked?: string;
}

/**
 * The phone. The red rotary phone is the button: hover or focus lifts the handset a little and 面包
 * turns to look; one click starts the real call. How a call works is the button's own description,
 * not a paragraph under it. When a call can't happen the phone stays put with its colour drained,
 * says why, and points back to typing — it never fakes a connection.
 *
 * On the home page the phone is the Blender model, drawn over the SVG one once it has loaded. The
 * <button>, its name and its static hit outline are the SVG phone's and never change: the canvas takes
 * no pointer, so pressing works the same before, during and after the model loads — or if it never does.
 */
export function CallLauncher({ caps, onCall, variant, blocked = '' }: CallLauncherProps) {
  const id = useDomId('call');
  const block = blocked || callBlockReason(caps);
  const detail = callBlockDetail(caps);
  const [hint, setHint] = useState('');
  const spatial = usePhone3D() && variant === 'hero';
  const [solid, setSolid] = useState(false);
  // Hover and keyboard focus raise the handset once; leaving lowers it after a beat. Driven by enter/leave
  // on a hit area that never moves, so a hand resting on an edge can't make it bob.
  const [near, setNearNow] = useState(false);
  const leaveTimer = useRef(0);
  const setNear = (on: boolean) => {
    window.clearTimeout(leaveTimer.current);
    if (on) setNearNow(true);
    else leaveTimer.current = window.setTimeout(() => setNearNow(false), 220);
  };
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  const onFocus = (e: FocusEvent<HTMLButtonElement>) => setNear(e.currentTarget.matches(':focus-visible'));

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
          data-phone
        >
          <PhoneGlyph className="call-pill__phone" />
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
    <div className={`phone-door phone-door--${variant} ${block ? 'is-blocked' : ''}`}>
      <button
        type="button"
        className="phone-door__btn"
        onClick={press}
        aria-disabled={!!block || undefined}
        aria-describedby={`${id}-pre`}
        data-phone
        title={block ? [block, detail].filter(Boolean).join(' ') : undefined}
        {...(spatial
          ? {
              onPointerEnter: () => setNear(true),
              onPointerLeave: () => setNear(false),
              onFocus,
              onBlur: () => setNear(false),
            }
          : {})}
      >
        {spatial ? (
          <span className={`phone-door__art ${solid ? 'is-3d' : ''}`}>
            <RedPhone pose={block ? 'down' : 'rest'} className="phone-door__phone" />
            <Phone3D
              layout={HERO_PHONE}
              pose={block ? 'down' : 'rest'}
              lift={near && !block}
              // No greeting hop: on a first screen meant to let a tired person settle, the phone waits to
              // be reached for. It answers the hand (the handset rises on hover/focus), never calls out.
              greet={false}
              onReady={setSolid}
            />
          </span>
        ) : (
          <RedPhone pose={block ? 'down' : 'rest'} className="phone-door__phone" />
        )}
        <span className="phone-door__text">
          <span className="phone-door__title">
            {variant === 'hero' && <PhoneGlyph className="phone-door__glyph" />}
            给面包打个电话
            {variant === 'hero' && <ArrowRight className="phone-door__go" aria-hidden="true" />}
          </span>
          <span className="phone-door__sub">{block || '用说的，不用打字'}</span>
        </span>
      </button>
      <span id={`${id}-pre`} className="sr-only">
        {block ? [block, detail].filter(Boolean).join(' ') : CALL_PREFACE}
      </span>
      <p className="sr-only" aria-live="polite">
        {hint}
      </p>
    </div>
  );
}

interface CompanionProps {
  buddy: BuddyState;
  /** What 面包 says; defaults to its usual line for the state. */
  line?: string;
  /** Short status in plain words, for the label under the figure. */
  status: string;
  caps: Capabilities | null;
  onCall: () => void;
  callBlocked: string;
}

/** Desktop: 面包's corner. The plush in its pool of light follows the real state; the phone sits right below it. */
export function CompanionPanel({ buddy, line = BUDDY_LINE[buddy], status, caps, onCall, callBlocked }: CompanionProps) {
  return (
    <aside className="companion" aria-label="面包">
      <div className="companion__figure">
        <p key={line} className="companion__bubble" data-state={buddy}>
          {line}
        </p>
        <LampScene state={buddy} className="companion__scene" pokeable />
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

/** Phones: a slim perch under the top bar — 面包, one line from it, and the phone. */
export function CompanionPerch({ buddy, line = BUDDY_LINE[buddy], status, caps, onCall, callBlocked }: CompanionProps) {
  return (
    <div className="perch" data-state={buddy}>
      <span className="perch__buddy">
        <BreadBuddy state={buddy} decorative />
      </span>
      <p className="perch__line">
        <span className="perch__name">面包</span>
        <span className="perch__say">{line}</span>
        <span className="sr-only">（{status}）</span>
      </p>
      <CallLauncher variant="pill" caps={caps} onCall={onCall} blocked={callBlocked} />
    </div>
  );
}
