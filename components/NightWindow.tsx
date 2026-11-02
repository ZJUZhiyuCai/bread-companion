'use client';

import { BreadBuddy, type BuddyState } from './BreadBuddy';
import { PhoneStill } from './RedPhone';

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
 * 面包's spot in the set: the key light falling on the wall from the upper left (never a disc centred
 * behind it — that reads as a cut-out's glow), and the pool of light on the floor it sits in. The light
 * is CSS, so the scene stays one figure wide and never fights the layout. The phone beside it is the
 * Blender still, the same object as everywhere else.
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
      {phone && <PhoneStill className="nook__phone" />}
    </div>
  );
}
