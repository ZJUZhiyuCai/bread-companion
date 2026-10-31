'use client';

import { useState, type CSSProperties } from 'react';
import type { CallState } from '@/domain/types';
import { PlushSvg } from './BreadBuddy';
import { Phone3D } from './Phone3D';
import { PhoneFigure, phonePose } from './RedPhone';
import { buddyForCall } from './call';
import { useDomId } from './hooks';
import { CALL_PHONE } from './phone3d/layouts';
import { usePhone3D } from './phone3d/usePhone3D';

/**
 * The call, as one picture: 面包 on the table and the red phone in front of it. One SVG, so the
 * handset can travel from the cradle to 面包's cheek in shared coordinates.
 *
 * The phone is the Blender model on a canvas laid exactly over the drawn one, in the same 1000×820
 * space: it is dialled and rings while connecting, its handset swings up to the photo's cheek with the
 * cord following once the line is open, and it goes back down on hold or hang-up. Until the model is up,
 * or if it can't be, the drawn phone does all of that itself.
 *
 * Every movement is the call's real phase — dial and ring while `connecting`, the handset comes up the
 * moment the line is open, goes back on hold when paused. There is no timer here that pretends to connect.
 */
export function CallStage({ call, level, className = '' }: { call: CallState; level: number; className?: string }) {
  const id = useDomId('stage');
  const pose = phonePose(call.phase);
  const spatial = usePhone3D();
  const [solid, setSolid] = useState(false);
  return (
    <div
      className={`cstage ${solid ? 'is-3d' : ''} ${className}`}
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
        <PlushSvg
          state={buddyForCall(call)}
          level={level}
          lookAt={[0.8, 0.6]}
          lit
          phoneLight
          frame={{ x: 30, y: 40, width: 720, height: 720 }}
        />
        <svg className="cstage__phone" x="600" y="490" width="380" height="321.54" viewBox="0 0 260 220" overflow="visible">
          <PhoneFigure pose={pose} id={id} />
        </svg>
      </svg>
      {spatial && <Phone3D layout={CALL_PHONE} pose={pose} onReady={setSolid} />}
    </div>
  );
}
