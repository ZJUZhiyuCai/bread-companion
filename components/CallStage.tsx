'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { CallState } from '@/domain/types';
import { PlushSvg } from './BreadBuddy';
import { Phone3D } from './Phone3D';
import { PhoneFigure, phonePose } from './RedPhone';
import { buddyForCall } from './call';
import { useDomId } from './hooks';
import { CALL_PHONE } from './phone3d/layouts';
import { usePhone3D } from './phone3d/usePhone3D';

type StillKey = 'rest' | 'lifted';
type StillState = 'loading' | 'ready' | 'failed';

/**
 * Two frames of the live model, exported from the engine at exactly CALL_PHONE's camera and placement,
 * each covering the whole 1000×820 picture: the handset in its cradle, and the handset at 面包's cheek.
 * They are only requested once a call is on screen — never on the home page's critical path.
 */
const CALL_STILLS: Record<StillKey, string> = {
  rest: '/companion/3d/bread-phone-call-rest.webp',
  lifted: '/companion/3d/bread-phone-call-lifted.webp',
};

/**
 * The call, as one picture: 面包 on the floor of the set and the red phone in front of it.
 *
 * There is one phone and it never changes face. It is the Blender model: live once its first frame has
 * really been painted, and until then a still of that same model from the same camera — the cradle
 * frame while dialling, ringing, on hold or failed, the cheek frame once the line is really open. A
 * still only takes over after it has loaded and decoded, so a phase change never flashes a blank or a
 * different phone: if the frame the new phase wants is still on its way, the one already up stays until
 * it is ready. The live model and the stills swap in the same frame — no cross-fade between two objects.
 *
 * The drawn phone is the last resort, per pose: only when that pose's still has failed and the live
 * model isn't up. One still failing never hides the other.
 *
 * Every pose is the call's real phase (phonePose). Stills are frames, not animation: the handset is never
 * shown moving unless the live model is moving it, and nothing here says the line is open before it is.
 * While it rings, the phone's warm light on the floor pulses in the ring's rhythm — light, not a shake.
 *
 * Behind 面包 is light, not a diagram: a soft patch of the key light on the wall that brightens with
 * your voice while it listens, holds while it speaks and takes one slow breath while it thinks.
 */
export function CallStage({ call, level, className = '' }: { call: CallState; level: number; className?: string }) {
  const id = useDomId('stage');
  const pose = phonePose(call.phase);
  const spatial = usePhone3D();
  const [solid, setSolid] = useState(false);

  const restRef = useRef<HTMLImageElement>(null);
  const liftedRef = useRef<HTMLImageElement>(null);
  const stills: Record<StillKey, StillState> = { rest: useDecoded(restRef), lifted: useDecoded(liftedRef) };

  const want: StillKey = pose === 'lifted' ? 'lifted' : 'rest';
  // The frame that was last on screen: held while the next one is still decoding.
  const held = useRef<StillKey | null>(null);
  const shown: StillKey | null = solid
    ? null
    : stills[want] === 'ready'
      ? want
      : stills[want] === 'failed'
        ? null
        : held.current;
  useEffect(() => {
    if (shown) held.current = shown;
  }, [shown]);
  // The drawing stands in only for a pose whose still is gone, and only while the model isn't up.
  const drawn = !solid && stills[want] === 'failed';

  return (
    <div
      className={`cstage ${solid ? 'is-3d' : ''} ${drawn ? 'is-drawn' : ''} ${className}`}
      data-phase={call.phase}
      data-pose={pose}
      style={{ '--lvl': level.toFixed(3) } as CSSProperties}
      aria-hidden="true"
    >
      <span className="cstage__light" />
      <span className="cstage__ring" />
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
      {(['rest', 'lifted'] as const).map((key) =>
        stills[key] === 'failed' ? null : (
          <img
            key={key}
            ref={key === 'rest' ? restRef : liftedRef}
            className={`cstage__still ${shown === key ? 'is-on' : ''}`}
            data-still={key}
            src={CALL_STILLS[key]}
            width={1000}
            height={820}
            alt=""
            draggable={false}
            decoding="async"
          />
        ),
      )}
      {spatial && <Phone3D layout={CALL_PHONE} pose={pose} onReady={setSolid} />}
    </div>
  );
}

/**
 * Whether an image is ready to be shown in one paint: loaded and decoded. Covers a load or a failure that
 * finished before hydration attached anything (a cached file, or a cached 404), as well as later ones.
 */
function useDecoded(ref: RefObject<HTMLImageElement | null>): StillState {
  const [state, setState] = useState<StillState>('loading');
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    let live = true;
    const fail = () => {
      if (live) setState('failed');
    };
    const loaded = () => {
      if (!live) return;
      if (img.naturalWidth === 0) {
        fail();
        return;
      }
      if (typeof img.decode !== 'function') {
        setState('ready');
        return;
      }
      img.decode().then(
        () => live && setState('ready'),
        // decode() can reject for reasons other than a broken file; a file with pixels is still usable.
        () => live && setState(img.naturalWidth > 0 ? 'ready' : 'failed'),
      );
    };
    if (img.complete) loaded();
    img.addEventListener('load', loaded);
    img.addEventListener('error', fail);
    return () => {
      live = false;
      img.removeEventListener('load', loaded);
      img.removeEventListener('error', fail);
    };
  }, [ref]);
  return state;
}
