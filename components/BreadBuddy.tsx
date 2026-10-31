import type { CSSProperties } from 'react';

/**
 * 面包 — a mountain-top toast with a wheat-ear sprig. Every layer (eyes, brows, mouth, arms, sprig,
 * extras) is picked from one table keyed by what the loaf is actually doing. Nothing here claims to
 * read the user's feelings: microphone level only drives a small nod and the sound arcs.
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

type Eyes = 'open' | 'wide' | 'happy' | 'closed' | 'up' | 'side' | 'down';
type Brows = 'none' | 'up' | 'think' | 'worry';
type Mouth = 'smile' | 'soft' | 'grin' | 'talk' | 'o' | 'hmm' | 'worry' | 'flat' | 'sleep';
type Arms = 'rest' | 'wave' | 'ear' | 'chin' | 'talk' | 'cheeks' | 'mug' | 'headset' | 'scratch' | 'lap';
type Sprig = 'sway' | 'perk' | 'droop' | 'bob';
type Extra = 'none' | 'dots' | 'arcs' | 'ripple' | 'zz' | 'mute' | 'warn' | 'rec' | 'ask';

interface Look {
  eyes: Eyes;
  brows: Brows;
  mouth: Mouth;
  arms: Arms;
  sprig: Sprig;
  extra: Extra;
}

const LOOK: Record<BuddyState, Look> = {
  idle: { eyes: 'open', brows: 'none', mouth: 'smile', arms: 'rest', sprig: 'sway', extra: 'none' },
  wave: { eyes: 'happy', brows: 'none', mouth: 'grin', arms: 'wave', sprig: 'perk', extra: 'none' },
  attentive: { eyes: 'down', brows: 'up', mouth: 'soft', arms: 'cheeks', sprig: 'perk', extra: 'none' },
  listening: { eyes: 'open', brows: 'up', mouth: 'soft', arms: 'ear', sprig: 'perk', extra: 'ripple' },
  hearing: { eyes: 'wide', brows: 'up', mouth: 'smile', arms: 'ear', sprig: 'perk', extra: 'ripple' },
  transcribing: { eyes: 'side', brows: 'none', mouth: 'flat', arms: 'ear', sprig: 'bob', extra: 'dots' },
  thinking: { eyes: 'up', brows: 'think', mouth: 'hmm', arms: 'chin', sprig: 'bob', extra: 'dots' },
  speaking: { eyes: 'open', brows: 'none', mouth: 'talk', arms: 'talk', sprig: 'sway', extra: 'arcs' },
  connecting: { eyes: 'side', brows: 'up', mouth: 'o', arms: 'headset', sprig: 'perk', extra: 'none' },
  asking: { eyes: 'side', brows: 'up', mouth: 'o', arms: 'rest', sprig: 'perk', extra: 'ask' },
  recording: { eyes: 'wide', brows: 'up', mouth: 'soft', arms: 'ear', sprig: 'perk', extra: 'rec' },
  muted: { eyes: 'happy', brows: 'none', mouth: 'soft', arms: 'lap', sprig: 'droop', extra: 'mute' },
  paused: { eyes: 'happy', brows: 'none', mouth: 'smile', arms: 'mug', sprig: 'sway', extra: 'none' },
  error: { eyes: 'open', brows: 'worry', mouth: 'worry', arms: 'scratch', sprig: 'droop', extra: 'warn' },
  asleep: { eyes: 'closed', brows: 'none', mouth: 'sleep', arms: 'lap', sprig: 'droop', extra: 'zz' },
};

/** [left arm path, left hand, right arm path, right hand]. Shoulders sit at (47,146) and (153,146). */
const ARMS: Record<Arms, [string, [number, number], string, [number, number]]> = {
  rest: ['M47 146 Q34 160 38 176', [38, 178], 'M153 146 Q166 160 162 176', [162, 178]],
  wave: ['M47 146 Q34 160 38 176', [38, 178], 'M153 144 Q172 132 176 108', [177, 104]],
  ear: ['M47 146 Q34 160 38 176', [38, 178], 'M153 144 Q178 134 170 112', [169, 108]],
  chin: ['M47 146 Q58 172 88 158', [90, 156], 'M153 146 Q166 160 162 176', [162, 178]],
  talk: ['M47 146 Q34 160 38 176', [38, 178], 'M153 146 Q176 152 182 132', [183, 129]],
  cheeks: ['M47 146 Q60 174 86 160', [88, 157], 'M153 146 Q140 174 114 160', [112, 157]],
  mug: ['M47 146 Q52 174 84 177', [86, 176], 'M153 146 Q148 174 116 177', [114, 176]],
  headset: ['M47 146 Q34 160 38 176', [38, 178], 'M153 144 Q178 124 168 100', [167, 96]],
  scratch: ['M47 146 Q34 160 38 176', [38, 178], 'M153 144 Q184 114 160 72', [158, 68]],
  lap: ['M47 146 Q48 172 74 182', [76, 182], 'M153 146 Q152 172 126 182', [124, 182]],
};

interface FigureProps {
  state: BuddyState;
  /** 0..1, microphone level while listening. Only nods and arcs follow it. */
  level?: number;
  /** On a voice call the loaf wears a little headset. */
  headset?: boolean;
}

/** The figure as an SVG group in a 200×224 box, so scenes can place it on a table. */
export function BuddyFigure({ state, level = 0, headset = false }: FigureProps) {
  const look = LOOK[state];
  const [lp, lh, rp, rh] = ARMS[look.arms];
  const lvl = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  return (
    <g
      className="buddy"
      data-state={state}
      data-arms={look.arms}
      data-headset={headset || undefined}
      style={{ '--lvl': lvl.toFixed(3) } as CSSProperties}
    >
      <ellipse className="b-shadow" cx="100" cy="216" rx="50" ry="5" />

      <g className="b-legs">
        <rect x="72" y="190" width="12" height="20" rx="6" />
        <rect x="116" y="190" width="12" height="20" rx="6" />
        <ellipse cx="77" cy="211" rx="9" ry="5" />
        <ellipse cx="123" cy="211" rx="9" ry="5" />
      </g>

      <g className="b-torso">
        <g className={`b-sprig b-sprig--${look.sprig}`}>
          <path className="b-sprig__stem" d="M100 62 C100 46 102 34 106 20" />
          <g className="b-sprig__grains">
            <ellipse cx="97.5" cy="47" rx="3.2" ry="5.4" transform="rotate(-35 97.5 47)" />
            <ellipse cx="105" cy="42" rx="3.2" ry="5.4" transform="rotate(35 105 42)" />
            <ellipse cx="99.5" cy="36" rx="3" ry="5.2" transform="rotate(-30 99.5 36)" />
            <ellipse cx="107.5" cy="31" rx="3" ry="5.2" transform="rotate(30 107.5 31)" />
            <ellipse cx="103" cy="25" rx="2.8" ry="4.8" transform="rotate(-20 103 25)" />
            <ellipse cx="107.5" cy="18" rx="2.8" ry="5" transform="rotate(12 107.5 18)" />
          </g>
          <path className="b-sprig__awns" d="M108 13 l2 -8 M104.5 15 l-3.5 -6.5 M111 16 l5.5 -5" />
        </g>

        <path
          className="b-crust"
          d="M58 198 C48 198 44 192 44 182 L44 114 C30 106 25 88 31 73 C38 55 56 45 75 47 C85 48 93 52 100 57 C107 52 115 48 125 47 C144 45 162 55 169 73 C175 88 170 106 156 114 L156 182 C156 192 152 198 142 198 Z"
        />
        <path
          className="b-crumb"
          d="M63 190 C57 190 53 186 53 180 L53 109 C40 102 35 89 40 77 C45 63 59 56 75 57 C84 58 92 62 100 67 C108 62 116 58 125 57 C141 56 155 63 160 77 C165 89 160 102 147 109 L147 180 C147 186 143 190 137 190 Z"
        />
        <path className="b-shine" d="M43 80 C47 68 57 61 68 59" />
        <g className="b-holes">
          <ellipse cx="70" cy="95" rx="2.2" ry="1.4" />
          <ellipse cx="129" cy="91" rx="1.8" ry="1.2" />
          <ellipse cx="64" cy="162" rx="2" ry="1.3" />
          <ellipse cx="138" cy="168" rx="2.3" ry="1.4" />
          <ellipse cx="110" cy="178" rx="1.7" ry="1.1" />
          <ellipse cx="84" cy="176" rx="1.5" ry="1" />
        </g>
        <g className="b-seeds">
          <ellipse cx="138" cy="51" rx="2.6" ry="1.3" transform="rotate(-8 138 51)" />
          <ellipse cx="149" cy="54.5" rx="2.6" ry="1.3" transform="rotate(24 149 54.5)" />
          <ellipse cx="158.5" cy="62" rx="2.6" ry="1.3" transform="rotate(48 158.5 62)" />
        </g>

        <g className="b-face">
          <ellipse className="b-cheek" cx="67" cy="135" rx="7" ry="4.4" />
          <ellipse className="b-cheek" cx="133" cy="135" rx="7" ry="4.4" />
          <Brows brows={look.brows} />
          <g className={`b-gaze b-gaze--${look.eyes}`}>
            <Eyes eyes={look.eyes} />
          </g>
          <MouthShape mouth={look.mouth} level={lvl} />
        </g>

        {headset && (
          <g className="b-headset">
            <path className="b-headset__band" d="M30 106 C22 20 178 20 170 106" />
            <rect className="b-headset__cup" x="21" y="94" width="16" height="27" rx="7.5" />
            <rect className="b-headset__cup" x="163" y="94" width="16" height="27" rx="7.5" />
            <path className="b-headset__pad" d="M29 99 v17 M171 99 v17" />
            <path className="b-headset__boom" d="M170 118 Q166 147 127 147" />
            <ellipse className="b-headset__mic" cx="123" cy="147" rx="5" ry="3.8" />
          </g>
        )}

        {look.arms === 'mug' && (
          <g className="b-mug">
            <path className="b-mug__steam" d="M95 157 c-3 -4 3 -6 0 -11 M105 157 c-3 -4 3 -6 0 -11" />
            <path className="b-mug__cup" d="M87 161 h26 v14 a9 9 0 0 1 -9 9 h-8 a9 9 0 0 1 -9 -9 Z" />
            <path className="b-mug__band" d="M87 167 h26" />
          </g>
        )}

        {/* keyed so a pose change eases in from the shoulder instead of snapping */}
        <g className="b-arms" key={look.arms}>
          <g className="b-arm b-arm--l">
            <path className="b-arm__line" d={lp} />
            <path className="b-arm__fill" d={lp} />
            <circle className="b-hand" cx={lh[0]} cy={lh[1]} r="7.5" />
          </g>
          <g className={`b-arm b-arm--r b-arm--${look.arms}`}>
            <path className="b-arm__line" d={rp} />
            <path className="b-arm__fill" d={rp} />
            <circle className="b-hand" cx={rh[0]} cy={rh[1]} r="7.5" />
          </g>
        </g>
      </g>

      <Extras extra={look.extra} />
    </g>
  );
}

function Eyes({ eyes }: { eyes: Eyes }) {
  if (eyes === 'happy') {
    return (
      <g className="b-eyes-line">
        <path d="M74 122 q6 -7.5 12 0" />
        <path d="M114 122 q6 -7.5 12 0" />
      </g>
    );
  }
  if (eyes === 'closed') {
    return (
      <g className="b-eyes-line">
        <path d="M74 119 q6 5.5 12 0" />
        <path d="M114 119 q6 5.5 12 0" />
      </g>
    );
  }
  return (
    <g className={`b-blink ${eyes === 'wide' ? 'is-wide' : ''}`}>
      <ellipse className="b-eye" cx="80" cy="120" rx="5.6" ry="6.8" />
      <ellipse className="b-eye" cx="120" cy="120" rx="5.6" ry="6.8" />
      <circle className="b-glint" cx="81.9" cy="117.4" r="1.9" />
      <circle className="b-glint" cx="121.9" cy="117.4" r="1.9" />
    </g>
  );
}

function Brows({ brows }: { brows: Brows }) {
  if (brows === 'none') return null;
  const d =
    brows === 'up'
      ? ['M73 106 q7 -4.5 14 -1.5', 'M113 104.5 q7 -3 14 1.5']
      : brows === 'think'
        ? ['M73 108 q7 -2 14 0', 'M113 103 q7 -5 14 0']
        : ['M73 110 L86 104.5', 'M114 104.5 L127 110'];
  return (
    <g className="b-brows">
      <path d={d[0]} />
      <path d={d[1]} />
    </g>
  );
}

function MouthShape({ mouth, level }: { mouth: Mouth; level: number }) {
  switch (mouth) {
    case 'smile':
      return <path className="b-mouth" d="M92 137 q8 8 16 0" />;
    case 'soft':
      return <path className="b-mouth" d="M95 138 q5 4.5 10 0" />;
    case 'grin':
      return (
        <g className="b-mouth-fill">
          <path d="M90 135 Q100 151 110 135 Z" />
          <ellipse className="b-tongue" cx="100" cy="142.5" rx="4" ry="2.2" />
        </g>
      );
    case 'talk':
      return (
        <g className="b-mouth-fill b-talk-outer" style={{ transform: `scale(1, ${(0.8 + level * 0.4).toFixed(3)})` }}>
          <g className="b-talk">
            <ellipse cx="100" cy="140" rx="6.2" ry="5.2" />
            <ellipse className="b-tongue" cx="100" cy="143" rx="3.4" ry="1.8" />
          </g>
        </g>
      );
    case 'o':
      return (
        <g className="b-mouth-fill">
          <ellipse cx="100" cy="140" rx="3.4" ry="4" />
        </g>
      );
    case 'hmm':
      return <path className="b-mouth" d="M93 140 q3.5 -3 7 0 q3.5 3 7 0" />;
    case 'worry':
      return <path className="b-mouth" d="M93 142 q7 -6 14 0" />;
    case 'flat':
      return <path className="b-mouth" d="M95 140 h10" />;
    case 'sleep':
      return (
        <g className="b-mouth-fill">
          <ellipse cx="100" cy="141" rx="2.6" ry="2.2" />
        </g>
      );
  }
}

function Extras({ extra }: { extra: Extra }) {
  switch (extra) {
    case 'none':
      return null;
    case 'dots':
      return (
        <g className="b-x b-x--dots">
          <circle cx="160" cy="40" r="3" />
          <circle cx="170" cy="29" r="4.4" />
          <circle cx="183" cy="16" r="6" />
        </g>
      );
    case 'arcs':
      return (
        <g className="b-x b-x--arcs">
          <path d="M28 128 q-6 9 0 18" />
          <path d="M18 121 q-11 16 0 32" />
        </g>
      );
    case 'ripple':
      return (
        <g className="b-x b-x--ripple">
          <path d="M186 100 q8 10 0 20" />
          <path d="M195 93 q13 17 0 34" />
        </g>
      );
    case 'zz':
      return (
        <g className="b-x b-x--zz">
          <text x="150" y="44">z</text>
          <text x="163" y="30">z</text>
        </g>
      );
    case 'mute':
      return (
        <g className="b-x b-badge b-badge--mute">
          <circle cx="34" cy="52" r="13" />
          <path d="M34 44 v9 M29.5 50.5 q4.5 7 9 0 M34 57.5 v3 M26 44 l16 16" />
        </g>
      );
    case 'warn':
      return (
        <g className="b-x b-badge b-badge--warn">
          <circle cx="34" cy="52" r="13" />
          <text x="34" y="57.5" textAnchor="middle">!</text>
        </g>
      );
    case 'ask':
      return (
        <g className="b-x b-badge b-badge--ask">
          <circle cx="34" cy="52" r="13" />
          <text x="34" y="57.5" textAnchor="middle">?</text>
        </g>
      );
    case 'rec':
      return (
        <g className="b-x b-badge b-badge--rec">
          <circle className="b-rec-ring" cx="34" cy="52" r="12" />
          <circle className="b-rec-dot" cx="34" cy="52" r="7" />
        </g>
      );
  }
}

interface BreadBuddyProps extends FigureProps {
  /** Text alternative. Omit together with `decorative` for purely ornamental copies. */
  label?: string;
  decorative?: boolean;
  className?: string;
}

export function BreadBuddy({ label, decorative = false, className = '', ...figure }: BreadBuddyProps) {
  return (
    <svg
      viewBox="0 0 200 224"
      className={`buddy-svg ${className}`}
      {...(decorative || !label ? { 'aria-hidden': true, focusable: false } : { role: 'img', 'aria-label': label })}
    >
      <BuddyFigure {...figure} />
    </svg>
  );
}

type MarkState = 'idle' | 'speaking' | 'thinking' | 'listening' | 'asleep';

/** The little face next to messages: crust, crumb, eyes and mouth, readable at 28px. */
export function BreadMark({ state = 'idle' }: { state?: MarkState }) {
  return (
    <svg viewBox="20 40 160 162" className="bread-mark" data-state={state} aria-hidden="true" focusable="false">
      <path
        className="b-crust"
        d="M58 198 C48 198 44 192 44 182 L44 114 C30 106 25 88 31 73 C38 55 56 45 75 47 C85 48 93 52 100 57 C107 52 115 48 125 47 C144 45 162 55 169 73 C175 88 170 106 156 114 L156 182 C156 192 152 198 142 198 Z"
      />
      <path
        className="b-crumb"
        d="M63 190 C57 190 53 186 53 180 L53 109 C40 102 35 89 40 77 C45 63 59 56 75 57 C84 58 92 62 100 67 C108 62 116 58 125 57 C141 56 155 63 160 77 C165 89 160 102 147 109 L147 180 C147 186 143 190 137 190 Z"
      />
      <ellipse className="b-cheek" cx="67" cy="135" rx="8" ry="5" />
      <ellipse className="b-cheek" cx="133" cy="135" rx="8" ry="5" />
      {state === 'asleep' ? (
        <g className="b-eyes-line bread-mark__line">
          <path d="M72 119 q8 7 16 0" />
          <path d="M112 119 q8 7 16 0" />
        </g>
      ) : (
        <g className={`b-gaze ${state === 'thinking' ? 'b-gaze--up' : ''}`}>
          <ellipse className="b-eye" cx="80" cy="120" rx="7.5" ry="9" />
          <ellipse className="b-eye" cx="120" cy="120" rx="7.5" ry="9" />
        </g>
      )}
      {state === 'speaking' ? (
        <g className="b-mouth-fill">
          <g className="b-talk">
            <ellipse cx="100" cy="142" rx="8" ry="6.5" />
          </g>
        </g>
      ) : state === 'thinking' ? (
        <path className="b-mouth bread-mark__line" d="M91 142 q4.5 -4 9 0 q4.5 4 9 0" />
      ) : (
        <path className="b-mouth bread-mark__line" d="M90 138 q10 10 20 0" />
      )}
    </svg>
  );
}
