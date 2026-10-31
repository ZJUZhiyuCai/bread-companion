'use client';

import type { CallPhase } from '@/domain/types';
import { BUN, BUN_EYES } from './Brand';
import { useDomId } from './hooks';

/**
 * The red rotary phone, in a 260×220 space, seen three-quarters from a little above with the same lamp
 * as 面包: warm key light from the upper left, shade and a long soft shadow toward the lower right.
 *
 * Built like the object: a plinth (top, front, lit chamfer), a lacquered body (sloped face, lit left
 * wall, dark right wall with a rim light, a top deck), a recessed dial — ivory number plate, a red
 * finger wheel with real thickness whose holes keep their inner wall on the far side as it turns, a
 * brass finger stop, a domed cap with the brand mark — cradle posts and plungers, a handset with its
 * own light for each pose, and a coiled cord that keeps its turns and opens up when stretched.
 *
 * Poses only ever come from the real call phase:
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

/* ---------- the body ---------- */

const PLINTH_TOP = 'M34 170 Q36 162 46 161 H214 Q224 162 226 170 L234 184 H26 Z';
const PLINTH_FRONT = 'M26 184 H234 Q240 184 240 189 V193 Q240 199 233 199 H27 Q20 199 20 193 V189 Q20 184 26 184 Z';
const BODY = 'M38 177 C35 150 44 120 62 100 C71 90 85 85 101 84 H159 C175 85 189 90 198 100 C216 120 225 150 222 177 Z';
const FACE = 'M52 177 C50 152 58 126 74 108 C81 100 91 97 103 97 H157 C169 97 179 100 186 108 C202 126 210 152 208 177 Z';
const DECK = 'M70 96 C77 87 89 83 102 83 H158 C171 83 183 87 190 96 C183 99 171 100 158 100 H102 C89 100 77 99 70 96 Z';
const PRONGS = [
  'M60 97 C59 86 60 76 64 71 H80 C84 76 85 86 84 97 Z',
  'M200 97 C201 86 200 76 196 71 H180 C176 76 175 86 176 97 Z',
];
const LIPS = [
  'M57 86 C63 92 81 92 87 86 L87 95 C81 101 63 101 57 95 Z',
  'M203 86 C197 92 179 92 173 86 L173 95 C179 101 197 101 203 95 Z',
];

/* ---------- the dial: drawn as circles, tilted into an ellipse by the face's slope ---------- */

const DX = 130;
const DY = 139;
const TILT = 0.84;
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** 1 at the upper right, round anticlockwise to 0 at the lower right; the finger stop sits in the gap. */
const HOLES = DIGITS.map((d, i) => {
  const a = ((-40 - 28 * i) * Math.PI) / 180;
  return { d, x: (28.5 * Math.cos(a)).toFixed(2), y: (28.5 * Math.sin(a)).toFixed(2) };
});
/** The far inner wall of a finger hole: the hole minus itself shifted toward the viewer. */
const WALL = 'M-6.9 1.2 A7 7 0 1 1 6.9 1.2 A7 7 0 0 0 -6.9 1.2 Z';
/** The wheel's edge, seen below its top face. */
const WHEEL_SIDE = 'M-39.47 1.6 A39.5 39.5 0 1 0 39.47 1.6 A39.5 39.5 0 0 1 -39.47 1.6 Z';

/* ---------- the handset, in its own space; centre of the handle at 0,0 ---------- */

const HANDSET =
  'M-60 -2 C-40 -15 40 -15 60 -2 L60 9 C40 -1 -40 -1 -60 9 Z ' +
  'M-90 8 C-91 -5 -82 -12 -70 -12 C-58 -12 -50 -6 -50 4 L-52 20 C-54 26 -61 28 -71 28 C-81 28 -88 26 -89 20 Z ' +
  'M90 8 C91 -5 82 -12 70 -12 C58 -12 50 -6 50 4 L52 20 C54 26 61 28 71 28 C81 28 88 26 89 20 Z';

/* ---------- the cord: a coil generated along a curve, same turns in every pose ---------- */

type Pt = [number, number];

function bezier(p: Pt[], t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0][0] + b * p[1][0] + c * p[2][0] + d * p[3][0], a * p[0][1] + b * p[1][1] + c * p[2][1] + d * p[3][1]];
}

function bezierTangent(p: Pt[], t: number): Pt {
  const u = 1 - t;
  return [
    3 * u * u * (p[1][0] - p[0][0]) + 6 * u * t * (p[2][0] - p[1][0]) + 3 * t * t * (p[3][0] - p[2][0]),
    3 * u * u * (p[1][1] - p[0][1]) + 6 * u * t * (p[2][1] - p[1][1]) + 3 * t * t * (p[3][1] - p[2][1]),
  ];
}

/**
 * A looped trochoid along the curve: the same number of points in every pose, so browsers that animate
 * `d` stretch the coil instead of swapping it. The loops ease in at both ends, where the cord meets a plug.
 */
function coil(p: Pt[], turns = 22, radius = 4.4, lead = 3.2, per = 10): string {
  const n = turns * per;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const [x, y] = bezier(p, t);
    const [dx, dy] = bezierTangent(p, t);
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len;
    const ty = dy / len;
    const a = (i / per) * Math.PI * 2;
    const k = Math.min(1, t * 12, (1 - t) * 12);
    const s = Math.sin(a) * radius * k;
    const c = (Math.cos(a) - 1) * lead * k;
    d += `${i ? 'L' : 'M'}${(x - ty * s + tx * c).toFixed(1)} ${(y + tx * s + ty * c).toFixed(1)}`;
  }
  return d;
}

/** Rest: out from under the right cup, a loop beside the body, into the back of the plinth. */
const CORD_REST = coil([
  [201, 93],
  [238, 98],
  [252, 152],
  [234, 186],
]);
/** Lifted: from the handset at 面包's cheek, down and behind the body. Start = the lifted pose's cup plug. */
const CORD_LIFTED = coil([
  [-53.6, 9.7],
  [-40, 78],
  [10, 130],
  [234, 186],
]);

/** Where a pointer can press the phone. Never transformed, so hover can't move it out from under the hand. */
const HIT = 'M14 186 C12 150 26 112 42 94 C42 72 52 52 70 52 H190 C208 52 218 72 218 94 C238 112 254 150 252 186 L246 204 H14 Z';

export function PhoneFigure({ pose, id }: { pose: PhonePose; id: string }) {
  const cord = pose === 'lifted' ? CORD_LIFTED : CORD_REST;
  return (
    <g className="rp" data-pose={pose}>
      <defs>
        {/* lacquer */}
        <linearGradient id={`${id}-walls`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#e65a45" />
          <stop offset="0.2" stopColor="#c8322b" />
          <stop offset="0.72" stopColor="#962021" />
          <stop offset="1" stopColor="#560e12" />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="0.2" y1="0" x2="0.6" y2="1">
          <stop offset="0" stopColor="#f06b52" />
          <stop offset="0.38" stopColor="#d23d30" />
          <stop offset="0.82" stopColor="#a52423" />
          <stop offset="1" stopColor="#7a171a" />
        </linearGradient>
        <linearGradient id={`${id}-deck`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f78368" />
          <stop offset="1" stopColor="#c8392d" />
        </linearGradient>
        <linearGradient id={`${id}-ptop`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#bf3029" />
          <stop offset="0.5" stopColor="#9a1f1e" />
          <stop offset="1" stopColor="#651215" />
        </linearGradient>
        <linearGradient id={`${id}-pfront`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#861a1b" />
          <stop offset="1" stopColor="#3e0a0d" />
        </linearGradient>
        <linearGradient id={`${id}-ao`} gradientUnits="userSpaceOnUse" x1="0" y1="150" x2="0" y2="178">
          <stop offset="0" stopColor="#2a0507" stopOpacity="0" />
          <stop offset="1" stopColor="#2a0507" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={`${id}-spec`}>
          <stop offset="0" stopColor="#fff" stopOpacity="0.62" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* 面包's cream fur, reflected in the lacquer on the side that faces it */}
        <radialGradient id={`${id}-fur`}>
          <stop offset="0" stopColor="#ffe9c8" stopOpacity="0.5" />
          <stop offset="1" stopColor="#ffe9c8" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${id}-body`}>
          <path d={BODY} />
        </clipPath>

        {/* the dial */}
        <linearGradient id={`${id}-well`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3d080b" />
          <stop offset="0.55" stopColor="#7b1518" />
          <stop offset="1" stopColor="#d65a45" />
        </linearGradient>
        <linearGradient id={`${id}-lip`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffb39d" stopOpacity="0.9" />
          <stop offset="0.5" stopColor="#c8322b" stopOpacity="0" />
          <stop offset="1" stopColor="#3d080b" stopOpacity="0.6" />
        </linearGradient>
        <radialGradient id={`${id}-plate`} cx="0.4" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="0.7" stopColor="#f1e3c8" />
          <stop offset="1" stopColor="#d6bd94" />
        </radialGradient>
        <radialGradient id={`${id}-wheel`} cx="0.34" cy="0.26" r="0.86">
          <stop offset="0" stopColor="#f47a62" />
          <stop offset="0.45" stopColor="#cf3a2f" />
          <stop offset="1" stopColor="#7e1719" />
        </radialGradient>
        <radialGradient id={`${id}-cap`} cx="0.38" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fffdf6" />
          <stop offset="0.7" stopColor="#f1e2c4" />
          <stop offset="1" stopColor="#c9ab7d" />
        </radialGradient>
        <linearGradient id={`${id}-brass`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3d9a4" />
          <stop offset="0.5" stopColor="#c9a16a" />
          <stop offset="1" stopColor="#7d5a2c" />
        </linearGradient>
        <mask id={`${id}-holes`} maskContentUnits="userSpaceOnUse">
          <circle r="39.5" fill="#fff" />
          {HOLES.map((h) => (
            <circle key={h.d} cx={h.x} cy={h.y} r="7" fill="#000" />
          ))}
        </mask>

        {/* the handset: one light for the cradle, one for when it is turned up against 面包 */}
        <linearGradient id={`${id}-hs-rest`} gradientUnits="userSpaceOnUse" x1="0" y1="-14" x2="0" y2="28">
          <stop offset="0" stopColor="#ffc2ad" stopOpacity="0.62" />
          <stop offset="0.3" stopColor="#ff8a70" stopOpacity="0.12" />
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#2a0507" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`${id}-hs-lift`} gradientUnits="userSpaceOnUse" x1="-30" y1="40" x2="10" y2="-20">
          <stop offset="0" stopColor="#ffc2ad" stopOpacity="0.55" />
          <stop offset="0.3" stopColor="#ff8a70" stopOpacity="0.12" />
          <stop offset="0.6" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#2a0507" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`${id}-hs-run`} gradientUnits="userSpaceOnUse" x1="-90" y1="0" x2="90" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="1" stopColor="#000" stopOpacity="0.2" />
        </linearGradient>

        {/* on the table */}
        <radialGradient id={`${id}-contact`}>
          <stop offset="0" stopColor="#1e0c06" stopOpacity="0.62" />
          <stop offset="1" stopColor="#1e0c06" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-cast`}>
          <stop offset="0" stopColor="#3a1a0c" stopOpacity="0.34" />
          <stop offset="1" stopColor="#3a1a0c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor="#ff5a3c" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ff5a3c" stopOpacity="0" />
        </radialGradient>
      </defs>

      <g className="rp-floor">
        <ellipse className="rp-redglow" cx="130" cy="196" rx="132" ry="18" fill={`url(#${id}-glow)`} />
        <ellipse cx="150" cy="200" rx="128" ry="15" fill={`url(#${id}-cast)`} />
        <ellipse cx="130" cy="198.5" rx="110" ry="5.5" fill={`url(#${id}-contact)`} />
      </g>

      <g className="rp-cord">
        <path className="rp-cord__base" d={cord} />
        <path className="rp-cord__tube" d={cord} />
        <path className="rp-cord__shine" d={cord} />
      </g>

      <g className="rp-shake">
        {/* plinth */}
        <path d={PLINTH_TOP} fill={`url(#${id}-ptop)`} />
        <path d={PLINTH_FRONT} fill={`url(#${id}-pfront)`} />
        <path className="rp-chamfer" d="M27 184.6 H233" />

        {/* body */}
        <path d={BODY} fill={`url(#${id}-walls)`} />
        <path d={DECK} fill={`url(#${id}-deck)`} />
        <path d={FACE} fill={`url(#${id}-face)`} />
        <g clipPath={`url(#${id}-body)`}>
          <rect x="30" y="150" width="200" height="30" fill={`url(#${id}-ao)`} />
          <ellipse cx="47" cy="146" rx="10" ry="26" transform="rotate(12 47 146)" fill={`url(#${id}-fur)`} />
          <ellipse cx="86" cy="122" rx="28" ry="14" transform="rotate(-38 86 122)" fill={`url(#${id}-spec)`} />
        </g>
        <path className="rp-edge rp-edge--lit" d="M52 177 C50 152 58 126 74 108" />
        <path className="rp-edge rp-edge--dark" d="M208 177 C210 152 202 126 186 108" />
        <path className="rp-edge rp-edge--top" d="M74 108 C81 100 91 97 103 97 H157 C169 97 179 100 186 108" />
        <path className="rp-window" d="M41 170 C39 147 47 121 64 101" />
        <path className="rp-window rp-window--soft" d="M44 168 C42 147 50 123 66 104" />
        <path className="rp-rim" d="M216 170 C217 145 210 121 197 104" />

        {/* dial */}
        <g transform={`translate(${DX} ${DY}) scale(1 ${TILT})`}>
          <circle r="44" fill={`url(#${id}-well)`} />
          <circle r="44" fill="none" stroke={`url(#${id}-lip)`} strokeWidth="1.8" />
          <circle r="40" fill={`url(#${id}-plate)`} />
          <circle className="rp-print" r="35" />
          <circle className="rp-print" r="22" />
          <g className="rp-digits">
            {HOLES.map((h) => (
              <text key={h.d} x={h.x} y={h.y} dy="2.5">
                {h.d}
              </text>
            ))}
          </g>
          <path className="rp-wheel__side" d={WHEEL_SIDE} />
          <g className="rp-wheel">
            <circle r="39.5" fill={`url(#${id}-wheel)`} mask={`url(#${id}-holes)`} />
            {HOLES.map((h) => (
              <g key={h.d} transform={`translate(${h.x} ${h.y})`}>
                <path className="rp-wall" d={WALL} />
                <circle className="rp-hole" r="7" />
              </g>
            ))}
          </g>
          <path className="rp-wheel__gloss" d="M-35.2 -12.8 A37.5 37.5 0 0 1 -12.8 -35.2" />
          <path className="rp-wheel__gloss rp-wheel__gloss--low" d="M35.2 12.8 A37.5 37.5 0 0 1 12.8 35.2" />
          <path className="rp-stop" d="M27 14.5 Q35 12.8 42 16.8" stroke={`url(#${id}-brass)`} />
          <path className="rp-stop__shine" d="M28 13.4 Q34 12.2 39 14" />
          <circle r="13.5" fill={`url(#${id}-cap)`} />
          <circle className="rp-cap__ring" r="13.5" stroke={`url(#${id}-brass)`} />
          <g className="rp-cap__mark" transform="translate(-6.4 -7.6) scale(0.2)">
            <path d={BUN} />
            {BUN_EYES.map(([x, y]) => (
              <ellipse key={x} className="rp-cap__eye" cx={x} cy={y} rx="4" ry="4.4" />
            ))}
          </g>
        </g>

        {/* cradle */}
        {PRONGS.map((d) => (
          <path key={d} d={d} fill={`url(#${id}-face)`} />
        ))}
        <g className="rp-plungers">
          <rect x="88" y="84" width="10" height="7" rx="2" />
          <rect x="162" y="84" width="10" height="7" rx="2" />
        </g>
        <ellipse className="rp-hs-shadow" cx="130" cy="91" rx="84" ry="6.5" fill={`url(#${id}-contact)`} />

        <g className="rp-hs-x">
          <g className="rp-hs-y">
            <g className="rp-hs-r">
              <g className="rp-handset">
                <path d={HANDSET} fill="#c8322b" />
                <path d={HANDSET} fill={`url(#${id}-hs-run)`} className="rp-hs-light rp-hs-light--rest" />
                <path d={HANDSET} fill={`url(#${id}-hs-rest)`} className="rp-hs-light rp-hs-light--rest" />
                <path d={HANDSET} fill={`url(#${id}-hs-lift)`} className="rp-hs-light rp-hs-light--lift" />
                <path className="rp-hs-rim" d="M-87 21 C-84 26.5 -58 26.5 -54 21 M87 21 C84 26.5 58 26.5 54 21" />
                <g className="rp-hs-light rp-hs-light--rest">
                  <path className="rp-shine" d="M-44 -9.5 C-20 -16 20 -16 44 -9.5" />
                  <path className="rp-shine rp-shine--cup" d="M-85 -3 Q-81 -10 -70 -11" />
                  <path className="rp-shine rp-shine--cup rp-shine--far" d="M56 -6 Q61 -11 71 -11" />
                </g>
                <g className="rp-hs-light rp-hs-light--lift">
                  <path className="rp-shine" d="M-46 7 C-24 1 24 1 46 7" />
                  <path className="rp-shine rp-shine--cup" d="M-88 14 Q-86 24 -74 27" />
                </g>
                <rect className="rp-plug" x="66" y="25.5" width="10" height="4" rx="1.5" />
              </g>
            </g>
          </g>
        </g>

        {LIPS.map((d) => (
          <path key={d} d={d} fill={`url(#${id}-face)`} />
        ))}
        <path className="rp-edge rp-edge--top" d="M57 86 C63 92 81 92 87 86 M203 86 C197 92 179 92 173 86" />
      </g>

      <g className="rp-bell">
        <path d="M30 92 q-10 -14 0 -30" />
        <path d="M18 98 q-16 -21 0 -42" />
        <path d="M230 92 q10 -14 0 -30" />
        <path d="M242 98 q16 -21 0 -42" />
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
      <path className="rp-hit" d={HIT} />
    </svg>
  );
}

/** A small, still version for pills and inline buttons: same phone and light, flat tones. */
export function PhoneGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 220" className={`rp-glyph ${className}`} aria-hidden="true" focusable="false">
      <path className="rp-glyph__deep" d={PLINTH_FRONT} />
      <path className="rp-glyph__mid" d={PLINTH_TOP} />
      <path className="rp-glyph__mid" d={BODY} />
      <path className="rp-glyph__lit" d={FACE} />
      <ellipse className="rp-glyph__dial" cx={DX} cy={DY} rx="40" ry={40 * TILT} />
      <ellipse className="rp-glyph__cap" cx={DX} cy={DY} rx="13" ry={13 * TILT} />
      <path className="rp-glyph__handset" d={HANDSET} transform="translate(130 64) scale(1.06)" />
      <path className="rp-glyph__shine" d="M92 59 C114 53 146 53 168 59" />
    </svg>
  );
}
