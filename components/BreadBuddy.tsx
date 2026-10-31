'use client';

import { Fragment, useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { useDomId } from './hooks';

/**
 * 面包 — a plush companion. The body is the original plush asset; everything that makes it alive is
 * drawn on top in the same 1254-unit space: glass eyes with a moving iris, lids made of the plush's
 * own fur, blush, a mouth that opens while it talks, breathing and small head turns.
 *
 * Nothing here reads the user. The eyes look at the user, at what the user is using (focus, pointer,
 * a tap) or at what 面包 itself is busy with; the microphone level only ever drives a small nod.
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
  | 'asleep';

export const PLUSH_SRC = '/companion/bread-plush.webp';
const S = 1254;

/** Socket centres measured on the asset. `fx` moves the eyelid fur sample toward the middle of the face. */
const EYES = [
  { side: 'l', cx: 421, cy: 585, fx: 40 },
  { side: 'r', cx: 835, cy: 586, fx: -40 },
] as const;
/** Between the eyes, as a fraction of the figure — where gaze is measured from. */
const EYE_MID: [number, number] = [628 / S, 585 / S];
/** Eyelids are cut from fur this far above (and below) the socket, so a blink is fur, not a patch. */
const FUR = 190;

const LID_TOP = 'M-130 -300 H130 V60 Q0 124 -130 60 Z';
const LID_TOP_EDGE = 'M-130 60 Q0 124 130 60';
const LID_TOP_SHADOW = 'M-130 60 Q0 124 130 60 V96 Q0 160 -130 96 Z';
const LID_BOTTOM = 'M-130 300 H130 V-40 Q0 -110 -130 -40 Z';
const LID_BOTTOM_EDGE = 'M-130 -40 Q0 -110 130 -40';

type Extra = 'dots' | 'zz' | 'mute' | 'rec' | null;

const EXTRA: Partial<Record<BuddyState, Extra>> = {
  thinking: 'dots',
  transcribing: 'dots',
  asleep: 'zz',
  muted: 'mute',
  recording: 'rec',
};

/** States in which the eyes may follow the pointer or the focused control. Talking and "heard you" keep eye contact. */
const FOLLOWS: BuddyState[] = ['idle', 'wave', 'attentive', 'listening', 'paused', 'recording'];
/** States that look around a little when nothing is happening. */
const WANDERS: BuddyState[] = ['idle', 'attentive', 'paused'];

interface FigureProps {
  state: BuddyState;
  /** 0..1, microphone level while listening. Only the nod follows it. */
  level?: number;
  /** Where to look while connecting, as a direction from the eyes (-1..1). */
  lookAt?: [number, number];
  /** Run the blink / gaze loop. Off for copies that only need a pose. */
  alive?: boolean;
}

interface PlushSvgProps extends FigureProps {
  /** Placement when nested inside a larger scene's SVG. */
  frame?: { x: number; y: number; width: number; height: number };
  className?: string;
  label?: string;
  svgRef?: RefObject<SVGSVGElement | null>;
}

/** The figure as an <svg>: standalone (sized by CSS) or nested inside a scene via `frame`. */
export function PlushSvg({ state, level = 0, lookAt, alive = true, frame, className = '', label, svgRef }: PlushSvgProps) {
  const own = useRef<SVGSVGElement>(null);
  const ref = svgRef ?? own;
  const id = useDomId('plush');
  const lvl = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  useLife(ref, state, alive, lookAt);

  const extra = EXTRA[state] ?? null;
  const mouth = state === 'speaking' || state === 'wave';

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
        <radialGradient id={`${id}-iris`} cx="0.42" cy="0.38" r="0.64">
          <stop offset="0" stopColor="#fff1c4" />
          <stop offset="0.26" stopColor="#f7c369" />
          <stop offset="0.6" stopColor="#d4812f" />
          <stop offset="0.86" stopColor="#8d4618" />
          <stop offset="1" stopColor="#4b220c" />
        </radialGradient>
        <radialGradient id={`${id}-glass`} cx="0.5" cy="0.56" r="0.58">
          <stop offset="0" stopColor="#3d2416" />
          <stop offset="1" stopColor="#0c0705" />
        </radialGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1a0d06" stopOpacity="0.78" />
          <stop offset="0.4" stopColor="#1a0d06" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-lidshade`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#140a04" stopOpacity="0.5" />
          <stop offset="1" stopColor="#140a04" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-blush`}>
          <stop offset="0" stopColor="#ff8a76" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ff8a76" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-ground`}>
          <stop offset="0" stopColor="#2a1608" stopOpacity="0.42" />
          <stop offset="1" stopColor="#2a1608" stopOpacity="0" />
        </radialGradient>
        {/* A feathered socket: the drawn eye and the fur lids melt into the real fur around them. */}
        <radialGradient id={`${id}-feather`}>
          <stop offset="0.9" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <mask id={`${id}-socket`} maskContentUnits="userSpaceOnUse">
          <ellipse rx="97" ry="88" fill={`url(#${id}-feather)`} />
        </mask>
        {EYES.map((e) => (
          <Fragment key={e.side}>
            <pattern id={`${id}-fur-${e.side}-t`} patternUnits="userSpaceOnUse" width={S} height={S} x={-e.cx - e.fx} y={-e.cy + FUR}>
              <image href={PLUSH_SRC} width={S} height={S} />
            </pattern>
            <pattern id={`${id}-fur-${e.side}-b`} patternUnits="userSpaceOnUse" width={S} height={S} x={-e.cx - e.fx} y={-e.cy - FUR}>
              <image href={PLUSH_SRC} width={S} height={S} />
            </pattern>
          </Fragment>
        ))}
      </defs>

      <ellipse className="p-ground" cx="627" cy="1196" rx="420" ry="44" fill={`url(#${id}-ground)`} />

      <g className="p-turn">
        <g className="p-pose">
          <g className="p-breathe">
            <image className="p-body" href={PLUSH_SRC} width={S} height={S} />
            <g className="p-blush">
              <ellipse cx="368" cy="716" rx="82" ry="42" fill={`url(#${id}-blush)`} />
              <ellipse cx="886" cy="716" rx="82" ry="42" fill={`url(#${id}-blush)`} />
            </g>
            {EYES.map((e) => (
              <Eye key={e.side} id={id} side={e.side} cx={e.cx} cy={e.cy} />
            ))}
            {mouth && (
              <g className="p-mouth">
                <ellipse cx="615" cy="642" rx="19" ry="13" />
                <ellipse className="p-mouth__tongue" cx="615" cy="649" rx="10" ry="5" />
              </g>
            )}
          </g>
        </g>
      </g>

      {extra && <Extras extra={extra} />}
    </svg>
  );
}

function Eye({ id, side, cx, cy }: { id: string; side: 'l' | 'r'; cx: number; cy: number }) {
  return (
    <g className={`p-eye p-eye--${side}`} transform={`translate(${cx} ${cy})`}>
      <g mask={`url(#${id}-socket)`}>
        <ellipse rx="100" ry="92" fill={`url(#${id}-glass)`} />
        <g className="p-look">
          <circle r="66" fill={`url(#${id}-iris)`} />
          <circle className="p-iris__fiber" r="45" />
          <circle className="p-iris__inner" r="31" />
          <circle className="p-iris__limbal" r="64" />
          <circle className="p-pupil" r="25" />
          <circle className="p-iris__glint" cx="17" cy="20" r="5.5" />
        </g>
        <ellipse rx="100" ry="92" fill={`url(#${id}-shade)`} />
        {/* The room's light: stays where it is while the iris moves under it. */}
        <g className="p-shine">
          <ellipse cx="-33" cy="-40" rx="23" ry="14" transform="rotate(-30 -33 -40)" />
          <circle cx="31" cy="36" r="7" />
          <path d="M-74 -10 Q-70 -52 -32 -70" />
        </g>
        <path className="p-rimlight" d="M-72 46 Q0 98 72 46" />
        <g className="p-lid p-lid--t">
          <path d={LID_TOP_SHADOW} fill={`url(#${id}-lidshade)`} />
          <path d={LID_TOP} fill={`url(#${id}-fur-${side}-t)`} />
          <path className="p-lid__edge" d={LID_TOP_EDGE} />
        </g>
        <g className="p-lid p-lid--b">
          <path d={LID_BOTTOM} fill={`url(#${id}-fur-${side}-b)`} />
          <path className="p-lid__edge p-lid__edge--b" d={LID_BOTTOM_EDGE} />
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
    case 'zz':
      return (
        <g className="p-x p-x--zz">
          <text x="980" y="300">z</text>
          <text x="1070" y="190">z</text>
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
/* Life: blinking and looking. Writes CSS variables straight onto the <svg>, so */
/* nothing re-renders; state lives in refs so the loop never restarts.          */
/* -------------------------------------------------------------------------- */

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

function stateGaze(s: BuddyState, now: number, still: boolean, lookAt?: [number, number]): [number, number] | null {
  switch (s) {
    case 'thinking':
      return [still ? 0.5 : 0.5 + Math.sin(now / 1700) * 0.14, -0.72];
    case 'transcribing':
      // reading its own notes, line by line
      return [still ? 0 : Math.floor(now / 640) % 2 ? 0.42 : -0.42, 0.3];
    case 'connecting':
      return lookAt ?? [0.62, 0.5];
    case 'asking':
      // toward where browsers put the permission prompt
      return [-0.55, -0.8];
    case 'muted':
      return [-0.12, 0.5];
    case 'error':
      return [-0.35, 0.32];
    case 'asleep':
      return [0, 0.3];
    default:
      return null;
  }
}

function isTextField(el: Element | null): el is HTMLElement {
  return !!el && (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'radio' && el.type !== 'checkbox'));
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

    let pointer: { x: number; y: number; t: number } | null = null;
    let focus: { el: Element; t: number } | null = null;
    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onFocus = (e: Event) => {
      if (e.target instanceof Element) focus = { el: e.target, t: performance.now() };
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    window.addEventListener('focusin', onFocus);
    window.addEventListener('input', onFocus, true);

    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };

    const blink = () => {
      svg.setAttribute('data-blink', '');
      later(() => svg.removeAttribute('data-blink'), 150);
    };

    let gx = 0;
    let gy = 0;
    let jx = 0;
    let jy = 0;
    let curious = false;
    const t0 = performance.now();
    let nextJitter = t0;
    let nextBlink = t0 + rand(1200, 3600);
    let nextWander = t0 + rand(5000, 9000);
    let wander: { x: number; y: number; until: number } | null = null;

    const write = (x: number, y: number) => {
      svg.style.setProperty('--gx', x.toFixed(3));
      svg.style.setProperty('--gy', y.toFixed(3));
    };

    let loop = 0;
    const tick = () => {
      loop = window.setTimeout(tick, 90);
      if (document.hidden) return;
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const now = performance.now();
      const s = stateRef.current;
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

      let target: [number, number] = s === 'paused' ? [0, 0.3] : [0, 0];
      let near: Element | null = null;
      const fixed = stateGaze(s, now, still, lookRef.current);
      if (fixed) {
        target = fixed;
      } else if (FOLLOWS.includes(s)) {
        const active = document.activeElement;
        const typing = s === 'attentive' && isTextField(active) ? active : null;
        const f = typing ?? (focus && now - focus.t < 4500 && watchable(focus.el) ? focus.el : null);
        if (f) {
          const r = f.getBoundingClientRect();
          target = toward(r.left + Math.min(r.width * 0.35, 200), r.top + r.height / 2);
          near = f;
        } else if (!still && pointer && now - pointer.t < 2600) {
          target = toward(pointer.x, pointer.y);
          near = document.elementFromPoint(pointer.x, pointer.y);
        }
      }

      if (!still && !near && !fixed && WANDERS.includes(s)) {
        if (wander && now > wander.until) wander = null;
        if (!wander && now > nextWander) {
          nextWander = now + rand(5000, 10000);
          if (Math.random() < 0.5) wander = { x: rand(-0.75, 0.75), y: rand(-0.5, 0.45), until: now + rand(700, 1800) };
        }
        if (wander) target = [wander.x, wander.y];
      } else {
        wander = null;
      }

      // Something to do with the phone nearby: a little more interest.
      const isCurious = !!near?.closest('[data-phone]:not([aria-disabled="true"])');
      if (isCurious !== curious) {
        curious = isCurious;
        if (curious) svg.setAttribute('data-curious', '');
        else svg.removeAttribute('data-curious');
      }

      if (!still && now > nextJitter) {
        jx = rand(-0.07, 0.07);
        jy = rand(-0.05, 0.05);
        nextJitter = now + rand(450, 1900);
      }
      const nx = clamp1(target[0] + (still ? 0 : jx));
      const ny = clamp1(target[1] + (still ? 0 : jy));
      const jump = Math.hypot(nx - gx, ny - gy);
      if (jump > 0.012) {
        // People tend to blink with a big change of gaze.
        if (!still && jump > 0.5 && s !== 'asleep' && Math.random() < 0.55) blink();
        gx = nx;
        gy = ny;
        write(gx, gy);
      }

      if (!still && s !== 'asleep' && now > nextBlink) {
        blink();
        if (Math.random() < 0.18) later(blink, 260);
        nextBlink = now + rand(2300, 6400);
      }
    };
    write(0, 0);
    tick();

    return () => {
      window.clearTimeout(loop);
      timers.forEach((t) => window.clearTimeout(t));
      mq.removeEventListener('change', onMq);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('input', onFocus, true);
      svg.removeAttribute('data-blink');
      svg.removeAttribute('data-curious');
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

type MarkState = 'idle' | 'speaking' | 'thinking' | 'listening' | 'asleep';

/** The little face next to messages: same plush, same eyes, simplified so it still reads at 30px. */
export function BreadMark({ state = 'idle' }: { state?: MarkState }) {
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="bread-mark" data-state={state} aria-hidden="true" focusable="false">
      <image href={PLUSH_SRC} width={S} height={S} />
      {EYES.map((e) => (
        <g key={e.side} transform={`translate(${e.cx} ${e.cy})`}>
          {state === 'asleep' ? (
            <>
              <ellipse className="pm-lid" rx="94" ry="85" />
              <path className="pm-crease" d="M-70 6 Q0 62 70 6" />
            </>
          ) : (
            <>
              <ellipse className="pm-glass" rx="92" ry="83" />
              <g className="pm-look">
                <circle className="pm-iris" r="62" />
                <circle className="pm-pupil" r="25" />
              </g>
              <ellipse className="pm-shine" cx="-30" cy="-36" rx="26" ry="18" />
            </>
          )}
        </g>
      ))}
    </svg>
  );
}
