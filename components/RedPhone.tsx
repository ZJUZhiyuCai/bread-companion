'use client';

import type { CallPhase } from '@/domain/types';
import { useDomId } from './hooks';

/**
 * The red rotary phone, drawn in layers in a 260×220 space: plinth, glossy body, a dial plate with a
 * finger wheel that really turns, a finger stop, cradle forks with hook-switch plungers, a coiled cord
 * and a separate handset. Poses only ever come from the real call phase:
 *
 *   rest     on the table, handset in the cradle
 *   dialing  `connecting`: the wheel is pulled round twice, then the phone rings until the line opens
 *   lifted   the line is open: the handset swings up to 面包's cheek (needs a scene; see CallStage)
 *   hold     paused: back in the cradle, a little askew
 *   down     unavailable or failed: in the cradle, colour drained
 */
export type PhonePose = 'rest' | 'dialing' | 'lifted' | 'hold' | 'down';

export function phonePose(phase: CallPhase): PhonePose {
  switch (phase) {
    case 'connecting':
      return 'dialing';
    case 'listening':
    case 'transcribing':
    case 'thinking':
    case 'speaking':
    case 'muted':
      return 'lifted';
    case 'paused':
      return 'hold';
    case 'error':
      return 'down';
    default:
      return 'rest';
  }
}

const DIAL_X = 130;
const DIAL_Y = 128;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** 1 at the upper right, round anticlockwise to 0 at the lower right; the finger stop sits in the gap. */
const HOLES = DIGITS.map((d, i) => {
  const a = ((-40 - 28 * i) * Math.PI) / 180;
  return { d, x: (DIAL_X + 30 * Math.cos(a)).toFixed(2), y: (DIAL_Y + 30 * Math.sin(a)).toFixed(2) };
});

/** Same commands in both, so browsers that animate `d` can stretch the cord between them. */
const CORD_REST = 'M60 158 C120 178 236 176 240 132 C243 100 226 78 214 62';
const CORD_LIFTED = 'M60 158 C30 170 -20 150 -40 120 C-56 90 -54 52 -46.5 28';

const BODY = 'M28 172 C24 132 40 96 70 80 C98 66 162 66 190 80 C220 96 236 132 232 172 Z';

export function PhoneFigure({ pose, id }: { pose: PhonePose; id: string }) {
  const cord = pose === 'lifted' ? CORD_LIFTED : CORD_REST;
  return (
    <g className="rp" data-pose={pose}>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f45a4b" />
          <stop offset="0.45" stopColor="#d3291f" />
          <stop offset="1" stopColor="#8a1010" />
        </linearGradient>
        <linearGradient id={`${id}-plinth`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a8160f" />
          <stop offset="1" stopColor="#5e0707" />
        </linearGradient>
        <radialGradient id={`${id}-gloss`} cx="0.3" cy="0.2" r="0.62">
          <stop offset="0" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-hs`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f65e4f" />
          <stop offset="0.55" stopColor="#c8221b" />
          <stop offset="1" stopColor="#7a0d0d" />
        </linearGradient>
        <radialGradient id={`${id}-well`} cx="0.5" cy="0.4" r="0.6">
          <stop offset="0.7" stopColor="#6a0c0a" />
          <stop offset="1" stopColor="#a81d17" />
        </radialGradient>
        <radialGradient id={`${id}-plate`} cx="0.42" cy="0.36" r="0.7">
          <stop offset="0" stopColor="#fffaf1" />
          <stop offset="1" stopColor="#e6d4b6" />
        </radialGradient>
        <linearGradient id={`${id}-wheel`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fffdf8" stopOpacity="0.96" />
          <stop offset="1" stopColor="#e2d0b1" stopOpacity="0.96" />
        </linearGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop offset="0" stopColor="#1e0c06" stopOpacity="0.45" />
          <stop offset="1" stopColor="#1e0c06" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-holes`} maskContentUnits="userSpaceOnUse">
          <circle cx={DIAL_X} cy={DIAL_Y} r="41" fill="#fff" />
          {HOLES.map((h) => (
            <circle key={h.d} cx={h.x} cy={h.y} r="7.6" fill="#000" />
          ))}
        </mask>
      </defs>

      <ellipse className="rp-shadow" cx="130" cy="202" rx="124" ry="14" fill={`url(#${id}-shadow)`} />

      <g className="rp-cord">
        <path className="rp-cord__base" d={cord} />
        <path className="rp-cord__coil" d={cord} />
      </g>

      <g className="rp-shake">
        <path d="M20 182 L28 168 H232 L240 182 Q242 198 224 198 H36 Q18 198 20 182 Z" fill={`url(#${id}-plinth)`} />
        <path d={BODY} fill={`url(#${id}-body)`} />
        <path d={BODY} fill={`url(#${id}-gloss)`} />
        <path className="rp-rim" d="M40 152 C42 120 56 98 82 85" />
        <path className="rp-rim rp-rim--soft" d="M221 158 C219 128 208 104 186 90" />

        <g className="rp-cradle" fill={`url(#${id}-body)`}>
          <path d="M52 90 V64 Q52 54 62 54 H70 Q80 54 80 64 V84 Z" />
          <path d="M180 84 V64 Q180 54 190 54 H198 Q208 54 208 64 V90 Z" />
        </g>
        {/* hook-switch plungers: hidden under the handset, they pop up when it is lifted */}
        <g className="rp-plungers">
          <rect x="59" y="58" width="14" height="12" rx="3" />
          <rect x="187" y="58" width="14" height="12" rx="3" />
        </g>

        <circle cx={DIAL_X} cy={DIAL_Y} r="47" fill={`url(#${id}-well)`} />
        <circle cx={DIAL_X} cy={DIAL_Y} r="42" fill={`url(#${id}-plate)`} />
        <g className="rp-digits">
          {HOLES.map((h) => (
            <text key={h.d} x={h.x} y={h.y} dy="2.6">
              {h.d}
            </text>
          ))}
        </g>
        <g className="rp-wheel">
          <circle cx={DIAL_X} cy={DIAL_Y} r="41" fill={`url(#${id}-wheel)`} mask={`url(#${id}-holes)`} />
          {HOLES.map((h) => (
            <circle key={h.d} className="rp-hole" cx={h.x} cy={h.y} r="7.6" />
          ))}
          <circle className="rp-cap" cx={DIAL_X} cy={DIAL_Y} r="15" />
          <text className="rp-cap__text" x={DIAL_X} y={DIAL_Y} dy="3">
            面包
          </text>
        </g>
        <path className="rp-stop" d="M163.5 143.5 L177 150" />

        <g className="rp-hs-x">
          <g className="rp-hs-y">
            <g className="rp-hs-r">
              <g className="rp-handset">
                <path d="M-88 12 Q-88 -1 -74 -1 H-54 Q-40 -1 -40 12 Q-40 26 -56 28 H-72 Q-88 26 -88 12 Z" fill={`url(#${id}-hs)`} />
                <path d="M88 12 Q88 -1 74 -1 H54 Q40 -1 40 12 Q40 26 56 28 H72 Q88 26 88 12 Z" fill={`url(#${id}-hs)`} />
                <ellipse className="rp-grille" cx="-64" cy="27" rx="17" ry="3.6" />
                <ellipse className="rp-grille" cx="64" cy="27" rx="17" ry="3.6" />
                <path d="M-70 4 C-56 -26 56 -26 70 4 L60 12 C46 -8 -46 -8 -60 12 Z" fill={`url(#${id}-hs)`} />
                <path className="rp-shine" d="M-50 -9 C-30 -21 30 -21 50 -9" />
                <path className="rp-shine rp-shine--cup" d="M-82 6 Q-80 1 -72 1" />
              </g>
            </g>
          </g>
        </g>
      </g>

      <g className="rp-bell">
        <path d="M22 76 q-9 -12 0 -26" />
        <path d="M10 82 q-14 -19 0 -38" />
        <path d="M238 76 q9 -12 0 -26" />
        <path d="M250 82 q14 -19 0 -38" />
      </g>
    </g>
  );
}

/** The phone on its own, sized by CSS. Always decorative: the button around it carries the name. */
export function RedPhone({ pose = 'rest', className = '' }: { pose?: PhonePose; className?: string }) {
  const id = useDomId('phone');
  return (
    <svg viewBox="0 0 260 220" className={`rp-svg ${className}`} data-pose={pose} aria-hidden="true" focusable="false">
      <PhoneFigure pose={pose} id={id} />
    </svg>
  );
}

/** A small, still version for pills and inline buttons: same phone, fewer layers. */
export function PhoneGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 220" className={`rp-glyph ${className}`} aria-hidden="true" focusable="false">
      <path className="rp-glyph__base" d="M20 182 L28 168 H232 L240 182 Q242 198 224 198 H36 Q18 198 20 182 Z" />
      <path className="rp-glyph__body" d={BODY} />
      <circle className="rp-glyph__dial" cx={DIAL_X} cy={DIAL_Y} r="40" />
      <circle className="rp-glyph__cap" cx={DIAL_X} cy={DIAL_Y} r="13" />
      <path
        className="rp-glyph__handset"
        d="M42 58 Q42 44 56 44 H76 Q86 44 90 36 C112 18 148 18 170 36 Q174 44 184 44 H204 Q218 44 218 58 Q218 74 202 76 H184 Q170 74 168 60 C150 46 110 46 92 60 Q90 74 76 76 H58 Q42 74 42 58 Z"
      />
      <path className="rp-glyph__shine" d="M104 36 C120 28 140 28 156 36" />
    </svg>
  );
}
