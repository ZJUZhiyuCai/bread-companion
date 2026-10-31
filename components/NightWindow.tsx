import { BuddyFigure, type BuddyState } from './BreadBuddy';

interface LampSceneProps {
  /** `false` is the end scene: the lamp goes out, the loaf falls asleep. */
  lit?: boolean;
  /** What the loaf is doing under the lamp. Ignored when the lamp is out. */
  state?: BuddyState;
  level?: number;
  /** Unique prefix for gradient ids, in case two scenes ever share a page. */
  idPrefix?: string;
  className?: string;
}

/**
 * The one big picture in the product: a lamp hanging over a small table, 面包 standing in its light,
 * a warm cup beside it and a little paper tag waiting to be written on. Pure inline SVG.
 */
export function LampScene({ lit = true, state = 'idle', level = 0, idPrefix = 'lamp', className = '' }: LampSceneProps) {
  const cone = `${idPrefix}-cone`;
  const halo = `${idPrefix}-halo`;
  return (
    <svg
      viewBox="0 0 360 340"
      className={`lamp-scene ${lit ? 'is-lit' : 'is-out'} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* CSS variables only resolve through style, not presentation attributes */}
        <linearGradient id={cone} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--lamp)', stopOpacity: 0.58 }} />
          <stop offset="0.72" style={{ stopColor: 'var(--lamp)', stopOpacity: 0.14 }} />
          <stop offset="1" style={{ stopColor: 'var(--lamp)', stopOpacity: 0 }} />
        </linearGradient>
        <radialGradient id={halo} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: 'var(--lamp)', stopOpacity: 0.5 }} />
          <stop offset="1" style={{ stopColor: 'var(--lamp)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>

      <g className="ls__stars">
        <circle cx="34" cy="38" r="1.5" />
        <circle cx="76" cy="18" r="1.1" />
        <circle cx="300" cy="30" r="1.3" />
        <circle cx="332" cy="84" r="1.1" />
        <circle cx="22" cy="132" r="1" />
        <circle cx="318" cy="150" r="0.9" />
      </g>

      <circle className="ls__halo" cx="180" cy="96" r="96" fill={`url(#${halo})`} />
      <path className="ls__cone" d="M150 100 L40 292 L320 292 L210 100 Z" fill={`url(#${cone})`} />

      <line className="ls__cord" x1="180" y1="0" x2="180" y2="62" />
      <path className="ls__shade" d="M144 100 C144 78 159 64 180 64 C201 64 216 78 216 100 Z" />
      <rect className="ls__shade-rim" x="140" y="97" width="80" height="6" rx="3" />
      <ellipse className="ls__bulb" cx="180" cy="105" rx="9" ry="5" />

      <ellipse className="ls__pool" cx="180" cy="294" rx="136" ry="13" />
      <rect className="ls__table" x="16" y="292" width="328" height="7" rx="3.5" />
      <rect className="ls__table-leg" x="42" y="299" width="8" height="41" rx="2" />
      <rect className="ls__table-leg" x="310" y="299" width="8" height="41" rx="2" />

      {/* a little paper tag, string and all — the "记号" before anything is written */}
      <g className="ls__tag" transform="rotate(-8 70 268)">
        <path d="M52 252 h30 l8 8 v22 h-38 Z" />
        <circle cx="82" cy="262" r="2.4" className="ls__tag-hole" />
        <path className="ls__tag-line" d="M58 268 h20 M58 275 h14" />
        <path className="ls__tag-string" d="M84 262 q14 -8 18 6" />
      </g>

      <g className="ls__mug">
        <path d="M262 258 h32 v24 a8 8 0 0 1 -8 8 h-16 a8 8 0 0 1 -8 -8 Z" />
        <path className="ls__mug-handle" d="M294 264 h5 a7 7 0 0 1 0 14 h-5" />
        <g className="ls__mug-steam">
          <path d="M271 250 c-4 -5 4 -8 0 -14" />
          <path d="M285 250 c-4 -5 4 -8 0 -14" />
        </g>
      </g>

      <g transform="translate(98 116) scale(0.82)">
        <BuddyFigure state={lit ? state : 'asleep'} level={level} />
      </g>
    </svg>
  );
}
