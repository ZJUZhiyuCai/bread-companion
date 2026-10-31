'use client';

import type { CSSProperties } from 'react';
import type { CallState } from '@/domain/types';
import { PlushSvg } from './BreadBuddy';
import { PhoneFigure, phonePose } from './RedPhone';
import { buddyForCall } from './call';
import { useDomId } from './hooks';

/**
 * The call, as one picture: 面包 on the table and the red phone in front of it. One SVG, so the
 * handset can travel from the cradle to 面包's cheek in shared coordinates.
 *
 * Every movement is the call's real phase — dial and ring while `connecting`, the handset comes up the
 * moment the line is open, goes back on hold when paused. There is no timer here that pretends to connect.
 */
export function CallStage({ call, level, className = '' }: { call: CallState; level: number; className?: string }) {
  const id = useDomId('stage');
  const pose = phonePose(call.phase);
  return (
    <div
      className={`cstage ${className}`}
      data-phase={call.phase}
      data-pose={pose}
      style={{ '--lvl': level.toFixed(3) } as CSSProperties}
      aria-hidden="true"
    >
      <div className="cstage__halo">
        <span />
        <span />
        <span />
      </div>
      <svg className="cstage__svg" viewBox="0 0 1000 820" focusable="false">
        <ellipse className="cstage__pool" cx="500" cy="770" rx="470" ry="44" />
        {/* While connecting, 面包 watches the phone (down and to the right). */}
        <PlushSvg state={buddyForCall(call)} level={level} lookAt={[0.8, 0.6]} frame={{ x: 30, y: 40, width: 720, height: 720 }} />
        <svg className="cstage__phone" x="600" y="490" width="380" height="321.54" viewBox="0 0 260 220" overflow="visible">
          <PhoneFigure pose={pose} id={id} />
        </svg>
      </svg>
    </div>
  );
}
