'use client';

import { BreadBuddy, type BuddyState } from './BreadBuddy';
import { RedPhone } from './RedPhone';

interface LampSceneProps {
  /** `false` is the end scene: the lamp turns down to a night light and 面包 says goodnight, eyes open. */
  lit?: boolean;
  /** What 面包 is doing in the light. Ignored when the light is down. */
  state?: BuddyState;
  level?: number;
  className?: string;
  /** 面包 can be patted here. Never on a call. */
  pokeable?: boolean;
  /** The red phone sits on the table beside it, handset down. */
  phone?: boolean;
  /** The phone stands at 面包's lower right even if it is drawn elsewhere (the home hero). */
  phoneNear?: boolean;
}

/**
 * A small warm nook: a pool of lamplight, a soft spot on the table, and 面包 sitting in it.
 * The light is CSS, so the scene stays one figure wide and never fights the layout.
 */
export function LampScene({
  lit = true,
  state = 'idle',
  level = 0,
  className = '',
  pokeable = false,
  phone = false,
  phoneNear = false,
}: LampSceneProps) {
  return (
    <div className={`nook ${lit ? 'is-lit' : 'is-out'} ${className}`}>
      <span className="nook__glow" aria-hidden="true" />
      <span className="nook__table" aria-hidden="true" />
      <BreadBuddy
        state={lit ? state : 'night'}
        level={level}
        decorative
        pokeable={pokeable && lit}
        lit
        phoneLight={phone || phoneNear}
        className="nook__plush"
      />
      {phone && <RedPhone pose="rest" className="nook__phone" />}
    </div>
  );
}
