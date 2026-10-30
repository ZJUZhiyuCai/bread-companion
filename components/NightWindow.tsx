import { LoafFigure } from './StateAvatar';

/** The lit bakery window at night. `lit={false}` is the end scene: the lamp goes out, the loaf sleeps. */
export function NightWindow({ lit = true, className = '' }: { lit?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 360 320"
      className={`night-window ${lit ? 'is-lit' : 'is-dim'} ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect className="nw__sky" width="360" height="320" rx="28" />
      <g className="nw__stars">
        <circle cx="38" cy="40" r="1.6" />
        <circle cx="92" cy="26" r="1.2" />
        <circle cx="150" cy="44" r="1.4" />
        <circle cx="236" cy="30" r="1.2" />
        <circle cx="330" cy="104" r="1.4" />
        <circle cx="24" cy="132" r="1.2" />
        <circle cx="338" cy="190" r="1.1" />
      </g>
      <g className="nw__moon">
        <circle cx="298" cy="54" r="20" />
        <circle className="nw__moon-cut" cx="308" cy="47" r="18" />
      </g>

      <circle className="nw__halo" cx="180" cy="160" r="150" />

      <rect className="nw__frame" x="66" y="70" width="228" height="178" rx="16" />
      <rect className="nw__glass" x="80" y="84" width="200" height="150" rx="9" />

      {/* pendant lamp */}
      <line className="nw__cord" x1="180" y1="84" x2="180" y2="104" />
      <path className="nw__shade" d="M162 118 Q180 96 198 118 Z" />
      <circle className="nw__bulb" cx="180" cy="120" r="5" />
      <path className="nw__beam" d="M164 120 L130 214 L230 214 L196 120 Z" />

      {/* shelf with tiny loaves */}
      <rect className="nw__shelf" x="92" y="182" width="176" height="5" rx="2" />
      <ellipse className="nw__bun" cx="112" cy="176" rx="13" ry="7" />
      <ellipse className="nw__bun" cx="140" cy="177" rx="10" ry="6" />
      <ellipse className="nw__bun" cx="226" cy="176" rx="14" ry="7" />
      <ellipse className="nw__bun" cx="252" cy="177" rx="9" ry="6" />

      <rect className="nw__mullion" x="177" y="84" width="6" height="150" />
      <rect className="nw__mullion" x="80" y="156" width="200" height="5" />

      <rect className="nw__sill" x="50" y="246" width="260" height="14" rx="5" />
      <rect className="nw__wall" x="0" y="260" width="360" height="60" />

      <g transform="translate(126 170) scale(0.9)">
        <LoafFigure state={lit ? 'idle' : 'ended'} />
      </g>
    </svg>
  );
}
