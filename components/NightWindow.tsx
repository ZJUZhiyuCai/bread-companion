import { LoafFigure } from './StateAvatar';

interface LampSceneProps {
  /** `false` is the end scene: the lamp goes out, the loaf falls asleep. */
  lit?: boolean;
  /** Unique prefix for gradient ids, in case two scenes ever share a page. */
  idPrefix?: string;
  className?: string;
}

/**
 * The one big picture in the product: a lamp hanging over a small table, a loaf on a plate,
 * a warm cup, and a little paper tag waiting to be written on. Pure inline SVG, no external assets.
 */
export function LampScene({ lit = true, idPrefix = 'lamp', className = '' }: LampSceneProps) {
  const cone = `${idPrefix}-cone`;
  const halo = `${idPrefix}-halo`;
  return (
    <svg
      viewBox="0 0 360 330"
      className={`lamp-scene ${lit ? 'is-lit' : 'is-out'} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* CSS variables only resolve through style, not presentation attributes */}
        <linearGradient id={cone} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--lamp)', stopOpacity: 0.62 }} />
          <stop offset="0.7" style={{ stopColor: 'var(--lamp)', stopOpacity: 0.16 }} />
          <stop offset="1" style={{ stopColor: 'var(--lamp)', stopOpacity: 0 }} />
        </linearGradient>
        <radialGradient id={halo} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: 'var(--lamp)', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--lamp)', stopOpacity: 0 }} />
        </radialGradient>
      </defs>

      <g className="ls__stars">
        <circle cx="34" cy="38" r="1.5" />
        <circle cx="76" cy="18" r="1.1" />
        <circle cx="300" cy="30" r="1.3" />
        <circle cx="332" cy="84" r="1.1" />
        <circle cx="22" cy="120" r="1" />
      </g>

      <circle className="ls__halo" cx="180" cy="102" r="92" fill={`url(#${halo})`} />
      <path className="ls__cone" d="M152 106 L46 286 L314 286 L208 106 Z" fill={`url(#${cone})`} />

      <line className="ls__cord" x1="180" y1="0" x2="180" y2="68" />
      <path className="ls__shade" d="M146 106 C146 84 160 70 180 70 C200 70 214 84 214 106 Z" />
      <rect className="ls__shade-rim" x="142" y="103" width="76" height="6" rx="3" />
      <ellipse className="ls__bulb" cx="180" cy="111" rx="9" ry="5" />

      <ellipse className="ls__pool" cx="180" cy="288" rx="132" ry="13" />
      <rect className="ls__table" x="18" y="286" width="324" height="7" rx="3.5" />
      <rect className="ls__table-leg" x="44" y="293" width="8" height="37" rx="2" />
      <rect className="ls__table-leg" x="308" y="293" width="8" height="37" rx="2" />

      {/* a little paper tag, string and all — the "记号" before anything is written */}
      <g className="ls__tag" transform="rotate(-8 82 262)">
        <path d="M64 246 h30 l8 8 v22 h-38 Z" />
        <circle cx="94" cy="256" r="2.4" className="ls__tag-hole" />
        <path className="ls__tag-line" d="M70 262 h20 M70 269 h14" />
        <path className="ls__tag-string" d="M96 256 q14 -8 18 6" />
      </g>

      <ellipse className="ls__plate" cx="180" cy="283" rx="60" ry="6.5" />
      <g transform="translate(126 199) scale(0.9)">
        <LoafFigure state={lit ? 'idle' : 'ended'} />
      </g>

      <g className="ls__mug">
        <path d="M252 250 h34 v26 a8 8 0 0 1 -8 8 h-18 a8 8 0 0 1 -8 -8 Z" />
        <path className="ls__mug-handle" d="M286 256 h5 a7 7 0 0 1 0 14 h-5" />
        <g className="ls__mug-steam">
          <path d="M262 242 c-4 -5 4 -8 0 -14" />
          <path d="M276 242 c-4 -5 4 -8 0 -14" />
        </g>
      </g>
    </svg>
  );
}
