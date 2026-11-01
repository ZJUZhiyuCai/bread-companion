'use client';

import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { useDomId } from './hooks';

/**
 * 面包 — a plush companion. The body is the original plush asset; what makes it alive is drawn on top
 * in the same 1254-unit space: glass safety eyes, blush, a mouth, breathing, small head turns, and the
 * light of the room it sits in (a warm key from the upper left, occlusion low on the right, a red
 * glow from the phone when the phone stands beside it).
 *
 * The eyes are always open, and they never change shape. There are no lids and no blink: a plush's
 * glass safety eyes don't close, and any squash of the bead — however quick — passes through the shape
 * of a half-open eye. What keeps them alive is the light: every so often the glint on the glass softens
 * and comes back, slowly, the way light moves on something wet. Rest, pause, trouble and goodnight are
 * carried by pose, light and small props.
 *
 * There is one mouth, and it is the one sewn into the plush: the stitched smile in the photo. Nothing
 * is drawn beside it. When 面包 speaks the seam itself parts — its upper edge is the stitch, only the
 * lower edge opens — and closes back into the photo's own smile between phrases. We don't have the
 * voice's loudness, so the mouth doesn't pretend to lip-sync: it speaks in loose phrases of small,
 * uneven syllables, never on a fixed beat. A hello or a pat parts the same seam into a held smile.
 *
 * She wears a little: three embroidered lashes at the outer corner of each eye (on the fur, never over
 * the bead), a rose blush, and a felt flower clipped at the root of her tuft.
 *
 * Nothing here reads the user. The eyes rest on the person; they only turn toward the phone when it
 * is hovered, toward a field being typed in, or toward what 面包 itself is busy with. The microphone
 * level only ever drives a small nod.
 */
export type BuddyState =
  | 'idle'
  | 'wave'
  | 'attentive'
  | 'listening'
  | 'hearing'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'connecting'
  | 'asking'
  | 'recording'
  | 'muted'
  | 'paused'
  | 'error'
  | 'night';

export const PLUSH_SRC = '/companion/bread-plush.webp';
const S = 1254;

/** Socket centres measured on the asset. `fx` moves the fur sample toward the middle of the face. */
const EYES = [
  { side: 'l', cx: 421, cy: 585, fx: 40 },
  { side: 'r', cx: 835, cy: 586, fx: -40 },
] as const;
/** Between the eyes, as a fraction of the figure — where gaze is measured from. */
const EYE_MID: [number, number] = [628 / S, 585 / S];

/**
 * The stitched smile in the asset: corners at (cx ± half, y), lowest point `dip` below them, centred on
 * x = 628 exactly. Every mouth shape below is built on this one seam.
 */
const SEAM = { cx: 628, y: 633, half: 37, dip: 15 } as const;

/**
 * The seam parted by `o` (0 closed … 1 as wide as 面包 ever opens). The upper edge rides a hair above
 * the stitch so it covers the thread; the corners draw in a little as it opens, still sewn at the ends;
 * only the lower edge travels.
 */
function mouthShape(o: number) {
  const pinch = 3 + o * 4;
  const l = (SEAM.cx - SEAM.half + pinch).toFixed(1);
  const r = (SEAM.cx + SEAM.half - pinch).toFixed(1);
  const top = SEAM.y - 2;
  const upper = SEAM.y + SEAM.dip * 2 - 3;
  const lower = (SEAM.y + SEAM.dip * 2 + 2 + o * 46).toFixed(1);
  return {
    lip: `M${l} ${top} Q${SEAM.cx} ${upper} ${r} ${top}`,
    open: `M${l} ${top} Q${SEAM.cx} ${upper} ${r} ${top} Q${SEAM.cx} ${lower} ${l} ${top}Z`,
  };
}
const SHUT = mouthShape(0);

/**
 * Embroidered lashes at the outer upper corner of the left eye (the right one is its mirror), rooted in
 * the fur just outside the bead's seat so they never cross the glass. `a` is where on the rim (degrees:
 * 0 toward the nose, 90 straight up, 180 the outer edge), `len` how long, `curl` how far the tip turns
 * up — a flick, never a droop. Each is a tapered quill: `w` wide at the root, a point at the tip.
 */
const LASHES = [
  { a: 128, len: 28, curl: 14, w: 6.5 },
  { a: 146, len: 33, curl: 19, w: 7.5 },
  { a: 163, len: 27, curl: 24, w: 6.5 },
].map(({ a, len, curl, w }) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const f = (x: number) => x.toFixed(1);
  // outward from the bead, and across it
  const nx = Math.cos(rad(a));
  const ny = -Math.sin(rad(a));
  const px = -ny * (w / 2);
  const py = nx * (w / 2);
  // the root: on the rim of the bead's seat, where the fur starts
  const bx = 97 * 1.04 * nx;
  const by = 91 * 1.04 * ny;
  const cx = bx + nx * len * 0.55;
  const cy = by + ny * len * 0.55;
  const tx = bx + Math.cos(rad(a - curl)) * len;
  const ty = by - Math.sin(rad(a - curl)) * len;
  return (
    `M${f(bx + px)} ${f(by + py)} Q${f(cx + px * 0.3)} ${f(cy + py * 0.3)} ${f(tx)} ${f(ty)}` +
    ` Q${f(cx - px * 0.3)} ${f(cy - py * 0.3)} ${f(bx - px)} ${f(by - py)}Z`
  );
});

/** A felt flower clipped at the root of the tuft; drawn in the room's light (public/design/soft-expression). */
const CLIP_SRC = '/design/soft-expression/felt-flower.svg';
const CLIP = { cx: 761, cy: 235, size: 150, rotate: -10 } as const;

type Extra = 'dots' | 'moon' | 'mute' | 'rec' | 'drop' | null;

const EXTRA: Partial<Record<BuddyState, Extra>> = {
  thinking: 'dots',
  transcribing: 'dots',
  night: 'moon',
  muted: 'mute',
  recording: 'rec',
  error: 'drop',
};

/** States in which the eyes may leave the person: toward the phone when it is hovered, or a field being typed in. */
const FOLLOWS: BuddyState[] = ['idle', 'wave', 'attentive', 'listening', 'paused', 'recording'];
/** Only a truly idle 面包 glances around, and only after a long quiet spell. */
const WANDERS: BuddyState[] = ['idle'];

/** A new place to look must be at least this far from the current one… */
const DEAD_ZONE = 0.14;
/** …and the eyes hold each fixation at least this long (ms). State changes are exempt. */
const HOLD = 320;
/** How long the light on the glass takes to soften and come back (ms). Matches p-glint in the CSS. */
const GLINT_MS = 900;

interface FigureProps {
  state: BuddyState;
  /** 0..1, microphone level while listening. Only the nod follows it. */
  level?: number;
  /** Where to look while connecting, as a direction from the eyes (-1..1). */
  lookAt?: [number, number];
  /** Run the glint / gaze loop. Off for copies that only need a pose. */
  alive?: boolean;
  /** Draw the room's light on the fur. Worth it at scene size; small avatars skip the extra layers. */
  lit?: boolean;
  /** The red phone stands at its lower right: a little of its colour lands on the fur. Needs `lit`. */
  phoneLight?: boolean;
}

interface PlushSvgProps extends FigureProps {
  /** Placement when nested inside a larger scene's SVG. */
  frame?: { x: number; y: number; width: number; height: number };
  className?: string;
  label?: string;
  svgRef?: RefObject<SVGSVGElement | null>;
}

/** The figure as an <svg>: standalone (sized by CSS) or nested inside a scene via `frame`. */
export function PlushSvg({
  state,
  level = 0,
  lookAt,
  alive = true,
  lit = false,
  phoneLight = false,
  frame,
  className = '',
  label,
  svgRef,
}: PlushSvgProps) {
  const own = useRef<SVGSVGElement>(null);
  const ref = svgRef ?? own;
  const id = useDomId('plush');
  const lvl = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  useLife(ref, state, alive, lookAt);
  useMouth(ref, state, alive);

  const extra = EXTRA[state] ?? null;

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${S} ${S}`}
      className={`plush ${className}`}
      data-state={state}
      style={{ '--lvl': lvl.toFixed(3) } as CSSProperties}
      {...(frame ?? {})}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false })}
    >
      <defs>
        {/* glass bead: near-black, a little warmer toward the middle */}
        <radialGradient id={`${id}-glass`} cx="0.46" cy="0.42" r="0.64">
          <stop offset="0" stopColor="#3b2316" />
          <stop offset="0.6" stopColor="#1c100a" />
          <stop offset="1" stopColor="#0a0503" />
        </radialGradient>
        {/* a warm brown iris that only shows where light gets into the glass */}
        <radialGradient id={`${id}-iris`} cx="0.5" cy="0.62" r="0.6">
          <stop offset="0" stopColor="#9a5b2c" />
          <stop offset="0.55" stopColor="#5f321a" />
          <stop offset="1" stopColor="#2a140a" stopOpacity="0" />
        </radialGradient>
        {/* thickness of the dome: the top of the bead is in its own shadow */}
        <linearGradient id={`${id}-depth`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.62" />
          <stop offset="0.42" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        {/* light through the glass lands on the far side, opposite the lamp */}
        <radialGradient id={`${id}-caustic`}>
          <stop offset="0" stopColor="#ffbf7a" stopOpacity="0.62" />
          <stop offset="0.55" stopColor="#e88a45" stopOpacity="0.22" />
          <stop offset="1" stopColor="#e88a45" stopOpacity="0" />
        </radialGradient>
        {/* where the bead presses into the fur */}
        <radialGradient id={`${id}-seat`}>
          <stop offset="0.78" stopColor="#2b1608" stopOpacity="0.42" />
          <stop offset="1" stopColor="#2b1608" stopOpacity="0" />
        </radialGradient>
        {/* a dusty rose, rubbed in rather than painted on */}
        <radialGradient id={`${id}-blush`}>
          <stop offset="0" stopColor="#ef8c97" stopOpacity="0.9" />
          <stop offset="0.55" stopColor="#f29da3" stopOpacity="0.38" />
          <stop offset="1" stopColor="#f29da3" stopOpacity="0" />
        </radialGradient>
        {/* inside the parted seam: dark at the stitch, a little warmth deep down when it opens wide */}
        <linearGradient id={`${id}-mouth`} gradientUnits="userSpaceOnUse" x1="0" y1={SEAM.y} x2="0" y2={SEAM.y + 44}>
          <stop offset="0" stopColor="#2a1209" />
          <stop offset="0.55" stopColor="#4a1f14" />
          <stop offset="1" stopColor="#94464a" />
        </linearGradient>
        {/* the fur gives a little around an open mouth */}
        <radialGradient id={`${id}-part`}>
          <stop offset="0" stopColor="#5a2c14" stopOpacity="0.32" />
          <stop offset="1" stopColor="#5a2c14" stopOpacity="0" />
        </radialGradient>

        {/* contact with the table: a tight dark seam and a long soft shade toward the lower right */}
        <radialGradient id={`${id}-ao`}>
          <stop offset="0" stopColor="#24120a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#24120a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-cast`}>
          <stop offset="0" stopColor="#3a2010" stopOpacity="0.26" />
          <stop offset="1" stopColor="#3a2010" stopOpacity="0" />
        </radialGradient>

        {/* the room's light on the fur, clipped to the plush's own outline */}
        <mask id={`${id}-body`} maskUnits="userSpaceOnUse" x="0" y="0" width={S} height={S} style={{ maskType: 'alpha' }}>
          <image href={PLUSH_SRC} width={S} height={S} />
        </mask>
        <radialGradient id={`${id}-key`} gradientUnits="userSpaceOnUse" cx="420" cy="300" r="680">
          <stop offset="0" stopColor="#fff2d8" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#ffe6bd" stopOpacity="0.3" />
          <stop offset="1" stopColor="#ffe6bd" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-shade`} gradientUnits="userSpaceOnUse" cx="1010" cy="1120" r="700">
          <stop offset="0" stopColor="#4a2510" stopOpacity="0.5" />
          <stop offset="0.6" stopColor="#4a2510" stopOpacity="0.14" />
          <stop offset="1" stopColor="#4a2510" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-bounce`} gradientUnits="userSpaceOnUse" cx="1140" cy="1040" r="380">
          <stop offset="0" stopColor="#ff4a33" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ff4a33" stopOpacity="0" />
        </radialGradient>

      </defs>

      <g className="p-ground">
        <ellipse cx="700" cy="1186" rx="500" ry="56" fill={`url(#${id}-cast)`} />
        <ellipse cx="627" cy="1172" rx="360" ry="30" fill={`url(#${id}-ao)`} />
        <ellipse cx="432" cy="1168" rx="128" ry="17" fill={`url(#${id}-ao)`} />
        <ellipse cx="826" cy="1168" rx="128" ry="17" fill={`url(#${id}-ao)`} />
      </g>

      <g className="p-turn">
        <g className="p-pose">
          <g className="p-breathe">
            <image className="p-body" href={PLUSH_SRC} width={S} height={S} />
            {lit && (
              <>
                <rect className="p-light p-light--key" width={S} height={S} fill={`url(#${id}-key)`} mask={`url(#${id}-body)`} />
                <rect className="p-light p-light--shade" width={S} height={S} fill={`url(#${id}-shade)`} mask={`url(#${id}-body)`} />
                {phoneLight && (
                  <rect className="p-light p-light--bounce" width={S} height={S} fill={`url(#${id}-bounce)`} mask={`url(#${id}-body)`} />
                )}
              </>
            )}
            <g className="p-blush">
              <ellipse cx="374" cy="704" rx="80" ry="50" fill={`url(#${id}-blush)`} />
              <ellipse cx="880" cy="704" rx="80" ry="50" fill={`url(#${id}-blush)`} />
            </g>
            <image
              className="p-clip"
              href={CLIP_SRC}
              x={CLIP.cx - CLIP.size / 2}
              y={CLIP.cy - CLIP.size / 2}
              width={CLIP.size}
              height={CLIP.size}
              transform={`rotate(${CLIP.rotate} ${CLIP.cx} ${CLIP.cy})`}
            />
            {EYES.map((e) => (
              <Eye key={e.side} id={id} side={e.side} cx={e.cx} cy={e.cy} phone={lit && phoneLight} />
            ))}
            {/* The photo's own stitched smile, parted. Closed, nothing here is visible. */}
            <g className="p-mouth">
              <ellipse className="p-mouth__part" cx={SEAM.cx} cy={SEAM.y + 20} rx="50" ry="24" fill={`url(#${id}-part)`} />
              <path className="p-mouth__open" d={SHUT.open} fill={`url(#${id}-mouth)`} />
              <path className="p-mouth__lip" d={SHUT.lip} />
            </g>
          </g>
        </g>
      </g>

      {extra && <Extras extra={extra} />}
    </svg>
  );
}

function Eye({ id, side, cx, cy, phone }: { id: string; side: 'l' | 'r'; cx: number; cy: number; phone: boolean }) {
  return (
    <g className={`p-eye p-eye--${side}`} transform={`translate(${cx} ${cy})`}>
      <g className="p-size">
        {/* lashes in the fur at the outer corner; they stay put while the bead looks around */}
        <g className="p-lashes" transform={side === 'r' ? 'scale(-1 1)' : undefined}>
          {LASHES.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <g className="p-ball">
          <ellipse cx="5" cy="9" rx="104" ry="98" fill={`url(#${id}-seat)`} />
          <ellipse rx="97" ry="91" fill={`url(#${id}-glass)`} />
          <g className="p-look">
            <circle r="60" fill={`url(#${id}-iris)`} />
            <circle className="p-pupil" r="34" />
          </g>
          <ellipse rx="97" ry="91" fill={`url(#${id}-depth)`} />
          <ellipse className="p-caustic" cx="16" cy="52" rx="54" ry="25" fill={`url(#${id}-caustic)`} />
          {/* The red phone at its lower right, caught small on the glass. */}
          {phone && (
            <g className="p-reflect">
              <ellipse cx="62" cy="46" rx="10" ry="4" transform="rotate(-36 62 46)" />
            </g>
          )}
          {/* The room's light: it stays where it is while the iris moves under it. */}
          <g className="p-shine">
            <ellipse cx="-34" cy="-42" rx="27" ry="16" transform="rotate(-32 -34 -42)" />
            <circle cx="36" cy="28" r="7" />
            <path d="M-78 18 Q-66 62 -20 80" />
          </g>
        </g>
      </g>
    </g>
  );
}

function Extras({ extra }: { extra: Exclude<Extra, null> }) {
  switch (extra) {
    case 'dots':
      return (
        <g className="p-x p-x--dots">
          <circle cx="1018" cy="262" r="20" />
          <circle cx="1084" cy="188" r="28" />
          <circle cx="1166" cy="100" r="38" />
        </g>
      );
    case 'moon':
      return (
        <g className="p-x p-x--moon">
          <path d="M1096 150 A92 92 0 1 0 1176 300 A74 74 0 1 1 1096 150 Z" />
          <circle className="p-x__star" cx="980" cy="120" r="12" />
          <circle className="p-x__star" cx="1200" cy="380" r="9" />
        </g>
      );
    case 'drop':
      return (
        <g className="p-x p-x--drop">
          <path d="M1000 236 C1022 280 1040 304 1040 332 C1040 357 1022 374 1000 374 C978 374 960 357 960 332 C960 304 978 280 1000 236 Z" />
          <path className="p-x__glint" d="M980 330 Q980 312 992 298" />
        </g>
      );
    case 'mute':
      return (
        <g className="p-x p-badge p-badge--mute">
          <circle cx="1060" cy="320" r="70" />
          <path d="M1060 278 v52 M1032 318 q28 40 56 0 M1060 352 v16 M1018 278 l84 84" />
        </g>
      );
    case 'rec':
      return (
        <g className="p-x p-badge p-badge--rec">
          <circle className="p-rec-ring" cx="1060" cy="320" r="62" />
          <circle className="p-rec-dot" cx="1060" cy="320" r="36" />
        </g>
      );
  }
}

/* -------------------------------------------------------------------------- */
/* Life: looking, and light on the glass. Writes CSS variables onto the <svg>, so */
/* nothing re-renders; state lives in refs so the loop never restarts.          */
/*                                                                            */
/* Attention works in fixations: the eyes pick a place, jump there once, and    */
/* stay. Small changes (a hand resting on the mouse, a scroll) fall inside a    */
/* dead zone and move nothing. There is no idle jitter.                        */
/* -------------------------------------------------------------------------- */

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function stateGaze(s: BuddyState, now: number, still: boolean, lookAt?: [number, number]): [number, number] | null {
  switch (s) {
    case 'thinking':
      // two slow resting points up and to the side, not a drift
      return still || Math.floor(now / 2800) % 2 === 0 ? [0.5, -0.7] : [0.28, -0.78];
    case 'transcribing':
      // reading its own notes, a line at a time
      return still || Math.floor(now / 1300) % 2 === 0 ? [-0.3, 0.32] : [0.34, 0.32];
    case 'connecting':
      return lookAt ?? [0.62, 0.5];
    case 'asking':
      // toward where browsers put the permission prompt
      return [-0.55, -0.8];
    case 'hearing':
    case 'speaking':
    case 'muted':
    case 'error':
      return [0, 0];
    case 'night':
      return [0, 0.08];
    default:
      return null;
  }
}

function isTextField(el: Element | null): el is HTMLElement {
  return !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'radio' && el.type !== 'checkbox'));
}

function phoneOf(t: EventTarget | null): Element | null {
  return t instanceof Element ? t.closest('[data-phone]:not([aria-disabled="true"])') : null;
}

function useLife(ref: RefObject<SVGSVGElement | null>, state: BuddyState, alive: boolean, lookAt?: [number, number]) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const lookRef = useRef(lookAt);
  lookRef.current = lookAt;

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !alive) return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let still = mq.matches;
    const onMq = () => {
      still = mq.matches;
    };
    mq.addEventListener('change', onMq);

    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };

    const t0 = performance.now();
    let pointer: { x: number; y: number; t: number } | null = null;
    let focus: { el: Element; t: number } | null = null;
    let lastInput = t0;

    const onMove = (e: PointerEvent) => {
      // A finger dragging to scroll is not something to watch; a tap is (pointerdown).
      if (e.type === 'pointermove' && e.pointerType === 'touch') return;
      pointer = { x: e.clientX, y: e.clientY, t: performance.now() };
      lastInput = pointer.t;
    };
    const onFocus = (e: Event) => {
      if (!(e.target instanceof Element)) return;
      focus = { el: e.target, t: performance.now() };
      lastInput = focus.t;
    };

    // Interest in the phone is driven by enter/leave, not polled, and leaving takes a beat — so passing
    // over an edge never makes 面包 bob up and down.
    let curious = false;
    let leaveTimer = 0;
    const setCurious = (on: boolean) => {
      window.clearTimeout(leaveTimer);
      if (on === curious) return;
      if (on) {
        curious = true;
        svg.setAttribute('data-curious', '');
        return;
      }
      leaveTimer = window.setTimeout(() => {
        curious = false;
        svg.removeAttribute('data-curious');
      }, 350);
    };
    const focusOnPhone = () => !!(phoneOf(document.activeElement) && document.activeElement?.matches(':focus-visible'));
    const onOver = (e: PointerEvent) => setCurious(!!phoneOf(e.target) || focusOnPhone());
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) setCurious(focusOnPhone());
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.matches(':focus-visible')) setCurious(!!phoneOf(e.target));
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!phoneOf(e.relatedTarget)) setCurious(false);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    window.addEventListener('focusin', onFocus);
    window.addEventListener('input', onFocus, true);
    document.addEventListener('pointerover', onOver, { passive: true });
    document.addEventListener('pointerout', onOut, { passive: true });
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    // The glint: the light on the glass softens and returns over GLINT_MS. The bead itself never moves.
    const glint = () => {
      if (still || svg.hasAttribute('data-glint')) return;
      svg.setAttribute('data-glint', '');
      later(() => svg.removeAttribute('data-glint'), GLINT_MS);
    };

    let gx = 0;
    let gy = 0;
    let lastSaccade = -Infinity;
    let lastState: BuddyState | null = null;
    let nextGlint = t0 + rand(4200, 7800);
    let nextWander = t0 + rand(16000, 24000);
    let wander: { x: number; y: number; until: number } | null = null;

    const write = () => {
      svg.style.setProperty('--gx', gx.toFixed(3));
      svg.style.setProperty('--gy', gy.toFixed(3));
    };

    let loop = 0;
    const tick = () => {
      loop = window.setTimeout(tick, 120);
      if (document.hidden) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const now = performance.now();
      const s = stateRef.current;
      const changed = s !== lastState;
      lastState = s;

      const ex = rect.left + rect.width * EYE_MID[0];
      const ey = rect.top + rect.height * EYE_MID[1];
      const toward = (x: number, y: number): [number, number] => {
        const dx = x - ex;
        const dy = y - ey;
        const d = Math.hypot(dx, dy) || 1;
        const m = Math.min(1, (d / (d + Math.max(120, rect.width * 0.55))) * 1.6) / d;
        return [dx * m, dy * m];
      };
      // Ignore the figure itself (or the button wrapped around it).
      const watchable = (el: Element) => el !== document.body && el.isConnected && !el.contains(svg) && !svg.contains(el);

      let target: [number, number] = s === 'paused' ? [0, 0.1] : [0, 0];
      let engaged = false;
      const fixed = stateGaze(s, now, still, lookRef.current);
      if (fixed) {
        target = fixed;
      } else if (FOLLOWS.includes(s)) {
        // The face rests on the person, not on the mouse. A pointer crossing the page is not a cue;
        // only a real place to look turns the eyes — the phone when it is hovered, the field while
        // you type — and each is one eased jump held in place.
        if (svg.hasAttribute('data-curious') && s !== 'hearing' && s !== 'speaking') {
          target = [0.5, 0.34];
          engaged = true;
        } else {
          const active = document.activeElement;
          const typing = s === 'attentive' && isTextField(active) ? active : null;
          const f = typing ?? (focus && now - focus.t < 4200 && watchable(focus.el) ? focus.el : null);
          if (f) {
            const r = f.getBoundingClientRect();
            target = toward(r.left + Math.min(r.width * 0.35, 200), r.top + r.height / 2);
            engaged = true;
          }
        }
      }

      // A rare, small glance aside after a long quiet spell — sitting with you, not scanning the room.
      if (!still && !engaged && !fixed && WANDERS.includes(s) && now - lastInput > 12000) {
        if (wander && now > wander.until) {
          wander = null;
          nextWander = now + rand(18000, 30000);
        }
        if (!wander && now > nextWander) {
          if (Math.random() < 0.4) wander = { x: rand(-0.38, 0.38), y: rand(-0.18, 0.22), until: now + rand(1800, 2800) };
          else nextWander = now + rand(18000, 30000);
        }
        if (wander) target = [wander.x, wander.y];
      } else {
        wander = null;
      }

      const dist = Math.hypot(target[0] - gx, target[1] - gy);
      const due = changed ? dist > 0.005 : dist > DEAD_ZONE && now - lastSaccade > HOLD;
      if (due) {
        gx = target[0];
        gy = target[1];
        lastSaccade = now;
        write();
      }

      if (!still && now > nextGlint) {
        glint();
        nextGlint = now + rand(5200, 9600);
      }
    };
    write();
    tick();

    return () => {
      window.clearTimeout(loop);
      window.clearTimeout(leaveTimer);
      timers.forEach((t) => window.clearTimeout(t));
      mq.removeEventListener('change', onMq);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('input', onFocus, true);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      svg.removeAttribute('data-glint');
      svg.removeAttribute('data-curious');
    };
  }, [ref, alive]);
}

/* -------------------------------------------------------------------------- */
/* The mouth: the stitched seam, parting. Writes the path and --open directly;   */
/* runs a frame loop only while the seam is moving, and sleeps otherwise until  */
/* the state or a pat changes.                                                  */
/*                                                                            */
/* `speaking` means the call's audio has really started. We can't hear that    */
/* audio here, and the microphone level is the user's, so the mouth doesn't     */
/* pretend to follow words: it speaks in loose phrases — small, uneven          */
/* syllables, then a closed pause — and never on a fixed beat. Between phrases  */
/* she lifts a little and settles (data-phrase, --tilt); the CSS does that.     */
/* -------------------------------------------------------------------------- */

/** How far the seam parts for a held smile (hello, a pat) and for a surprised pat. */
const SMILE_OPEN = 0.46;
const OH_OPEN = 0.2;
/** With reduced motion, speech is a still, slightly parted mouth. */
const STILL_OPEN = 0.4;

function useMouth(ref: RefObject<SVGSVGElement | null>, state: BuddyState, alive: boolean) {
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !alive) return;
    const fill = svg.querySelector<SVGPathElement>('.p-mouth__open');
    const lip = svg.querySelector<SVGPathElement>('.p-mouth__lip');
    if (!fill || !lip) return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let still = mq.matches;

    let open = 0;
    let shown = -1;
    const draw = (o: number) => {
      // Always paint the closed endpoint before the frame loop sleeps. Otherwise the small-update
      // threshold can leave a faint mouth behind after pause/stop (e.g. --open: 0.002).
      if (o === shown || (o !== 0 && Math.abs(o - shown) < 0.003)) return;
      shown = o;
      const m = mouthShape(o);
      fill.setAttribute('d', m.open);
      lip.setAttribute('d', m.lip);
      svg.style.setProperty('--open', o.toFixed(3));
    };

    // Speech cadence: phrases of 1.4–3.4 s, syllables of 150–270 ms, closed pauses of 0.4–0.9 s.
    let inPhrase = false;
    let phraseEnd = 0;
    let nextBeat = 0;
    let syllable = 0;
    const setPhrase = (on: boolean) => {
      if (on === inPhrase) return;
      inPhrase = on;
      if (on) {
        svg.style.setProperty('--tilt', rand(-1, 1).toFixed(2));
        svg.setAttribute('data-phrase', '');
      } else {
        svg.removeAttribute('data-phrase');
      }
    };
    const speak = (now: number) => {
      if (now < nextBeat) return syllable;
      if (inPhrase && now >= phraseEnd) {
        setPhrase(false);
        syllable = 0;
        nextBeat = now + rand(380, 900);
      } else {
        if (!inPhrase) {
          setPhrase(true);
          phraseEnd = now + rand(1400, 3400);
        }
        // mostly middling, now and then barely parted; each one its own height and length
        syllable = Math.random() < 0.2 ? rand(0.1, 0.28) : rand(0.38, 0.9);
        nextBeat = now + rand(150, 270);
      }
      return syllable;
    };

    const goal = (now: number) => {
      const s = stateRef.current;
      if (s === 'speaking' && !still) return speak(now);
      setPhrase(false);
      nextBeat = 0;
      if (s === 'speaking') return STILL_OPEN;
      const pat = svg.getAttribute('data-poke');
      if (s === 'wave' || pat === 'smile') return SMILE_OPEN;
      if (pat === 'wiggle') return OH_OPEN;
      return 0;
    };

    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      raf = 0;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const g = goal(now);
      const talking = stateRef.current === 'speaking';
      // syllables open quickly and close a touch slower; smiles arrive and leave unhurried
      const tau = g > open ? (talking ? 55 : 150) : talking ? 85 : 200;
      open = still ? g : open + (g - open) * (1 - Math.exp(-dt / tau));
      if (Math.abs(g - open) < 0.002) open = g;
      draw(open);
      if ((talking && !still) || open !== g) raf = window.requestAnimationFrame(frame);
      else last = 0;
    };
    const wake = () => {
      if (!raf) raf = window.requestAnimationFrame(frame);
    };

    const onMq = () => {
      still = mq.matches;
      wake();
    };
    mq.addEventListener('change', onMq);
    // React sets data-state; BreadBuddy sets data-poke. Either one wakes the seam.
    const watch = new MutationObserver(wake);
    watch.observe(svg, { attributes: true, attributeFilter: ['data-state', 'data-poke'] });
    wake();

    return () => {
      window.cancelAnimationFrame(raf);
      watch.disconnect();
      mq.removeEventListener('change', onMq);
      fill.setAttribute('d', SHUT.open);
      lip.setAttribute('d', SHUT.lip);
      svg.style.removeProperty('--open');
      svg.style.removeProperty('--tilt');
      svg.removeAttribute('data-phrase');
    };
  }, [ref, alive]);
}

/* -------------------------------------------------------------------------- */

interface BreadBuddyProps extends FigureProps {
  /** Text alternative. Omit together with `decorative` for purely ornamental copies. */
  label?: string;
  decorative?: boolean;
  className?: string;
  /**
   * A plain button that only makes 面包 react (squish, smile, look). Pressing it with a mouse never
   * takes focus away from a text box, and it is never used during a call.
   */
  pokeable?: boolean;
}

export function BreadBuddy({ label, decorative = false, className = '', pokeable = false, ...figure }: BreadBuddyProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pokeTimer = useRef(0);

  useEffect(() => () => window.clearTimeout(pokeTimer.current), []);

  const poke = () => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.removeAttribute('data-poke');
    // restart the squish even on a quick second tap
    void svg.getBoundingClientRect();
    svg.setAttribute('data-poke', Math.random() < 0.55 ? 'smile' : 'wiggle');
    window.clearTimeout(pokeTimer.current);
    pokeTimer.current = window.setTimeout(() => svg.removeAttribute('data-poke'), 1100);
  };

  const art = <PlushSvg {...figure} svgRef={svgRef} label={decorative ? undefined : label} />;
  if (!pokeable) return <span className={`plush-wrap ${className}`}>{art}</span>;
  return (
    <button
      type="button"
      className={`plush-wrap plush-poke ${className}`}
      aria-label="摸摸面包"
      onMouseDown={(e) => e.preventDefault()}
      onClick={poke}
    >
      {art}
    </button>
  );
}

type MarkState = 'idle' | 'speaking' | 'thinking' | 'listening' | 'night';

/** The little face next to messages: same plush, same glass eyes, flattened so it still reads at 30px. */
export function BreadMark({ state = 'idle' }: { state?: MarkState }) {
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="bread-mark" data-state={state} aria-hidden="true" focusable="false">
      <image href={PLUSH_SRC} width={S} height={S} />
      {EYES.map((e) => (
        <g key={e.side} transform={`translate(${e.cx} ${e.cy})`}>
          <ellipse className="pm-glass" rx="96" ry="90" />
          <g className="pm-look">
            <circle className="pm-iris" r="58" />
            <circle className="pm-pupil" r="34" />
          </g>
          <ellipse className="pm-shine" cx="-32" cy="-38" rx="28" ry="19" />
          <circle className="pm-dot" cx="34" cy="28" r="10" />
        </g>
      ))}
    </svg>
  );
}
