'use client';

import { BreadBuddy, type BuddyState } from './BreadBuddy';
import { RedPhone } from './RedPhone';

interface LampSceneProps {
  /** `false` is the end scene: the warm light dims and 面包 falls asleep. */
  lit?: boolean;
  /** What 面包 is doing in the light. Ignored when the light is out. */
  state?: BuddyState;
  level?: number;
  className?: string;
  /** 面包 can be patted here. Never on a call. */
  pokeable?: boolean;
  /** The red phone sits on the table beside it, handset down. */
  phone?: boolean;
}

/**
 * A small warm nook: a pool of lamplight, a soft spot on the table, and 面包 sitting in it.
 * The light is CSS, so the scene stays one figure wide and never fights the layout.
 */
export function LampScene({ lit = true, state = 'idle', level = 0, className = '', pokeable = false, phone = false }: LampSceneProps) {
  return (
    <div className={`nook ${lit ? 'is-lit' : 'is-out'} ${className}`}>
      <span className="nook__glow" aria-hidden="true" />
      <span className="nook__table" aria-hidden="true" />
      <BreadBuddy state={lit ? state : 'asleep'} level={level} decorative pokeable={pokeable && lit} className="nook__plush" />
      {phone && <RedPhone pose="rest" className="nook__phone" />}
    </div>
  );
}
