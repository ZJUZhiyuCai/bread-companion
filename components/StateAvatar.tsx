import { ACTIVITY_META, type AvatarState } from './labels';

type Face = 'resting' | 'open' | 'focus' | 'worried';

const FACE_BY_STATE: Record<AvatarState, Face> = {
  idle: 'resting',
  paused: 'resting',
  ended: 'resting',
  requesting_mic: 'open',
  recording: 'open',
  recorded: 'open',
  speaking: 'open',
  transcribing: 'focus',
  generating: 'focus',
  validating: 'focus',
  error: 'worried',
};

/**
 * The loaf itself, drawn in a 120×100 box. Shared by the status avatar and the window scenes,
 * so the bread on the windowsill is the same character that talks to you.
 */
export function LoafFigure({ state }: { state: AvatarState }) {
  const face = FACE_BY_STATE[state];
  const speaking = state === 'speaking';
  return (
    <g className="loaf" data-state={state}>
      <ellipse className="loaf__plate" cx="60" cy="88" rx="44" ry="5" />
      <g className="loaf__body">
        <path
          className="loaf__crust"
          d="M14 70 C14 43 35 25 60 25 C85 25 106 43 106 70 C106 80 98 84 88 84 L32 84 C22 84 14 80 14 70 Z"
        />
        <path className="loaf__sheen" d="M27 54 C33 39 46 32 60 32 C75 32 87 39 93 52" />
        <g className="loaf__scores">
          <path d="M37 42 q7 -8 16 -8" />
          <path d="M54 36 q7 -6 16 -5" />
          <path d="M71 40 q6 -4 13 -1" />
        </g>
        <g className="loaf__face">
          {face === 'resting' && (
            <>
              <path d="M43 61 q5 5 10 0" />
              <path d="M67 61 q5 5 10 0" />
            </>
          )}
          {face === 'open' && (
            <>
              <circle cx="48" cy="60" r="3" className="loaf__eye" />
              <circle cx="72" cy="60" r="3" className="loaf__eye" />
            </>
          )}
          {face === 'focus' && (
            <>
              <path d="M43 62 h10" />
              <path d="M67 62 h10" />
            </>
          )}
          {face === 'worried' && (
            <>
              <path d="M43 56 l9 2" />
              <path d="M77 56 l-9 2" />
              <circle cx="48" cy="62" r="2.4" className="loaf__eye" />
              <circle cx="72" cy="62" r="2.4" className="loaf__eye" />
            </>
          )}
          {speaking ? (
            <ellipse className="loaf__mouth" cx="60" cy="70" rx="3.6" ry="2.6" />
          ) : (
            <path d={face === 'worried' ? 'M55 72 q5 -3 10 0' : 'M55 69 q5 4 10 0'} />
          )}
        </g>
        <circle className="loaf__cheek" cx="38" cy="68" r="4" />
        <circle className="loaf__cheek" cx="82" cy="68" r="4" />
      </g>

      {speaking && (
        <g className="loaf__steam">
          <path d="M48 20 c-5 -5 5 -9 0 -15" />
          <path d="M60 18 c-5 -5 5 -9 0 -15" />
          <path d="M72 20 c-5 -5 5 -9 0 -15" />
        </g>
      )}
      {(state === 'generating' || state === 'validating' || state === 'transcribing') && (
        <g className="loaf__flour">
          <circle cx="46" cy="14" r="2.6" />
          <circle cx="60" cy="9" r="2.6" />
          <circle cx="74" cy="14" r="2.6" />
        </g>
      )}
      {state === 'recording' && (
        <g className="loaf__rec">
          <circle className="loaf__rec-ring" cx="102" cy="26" r="9" />
          <circle className="loaf__rec-dot" cx="102" cy="26" r="6" />
        </g>
      )}
      {state === 'recorded' && <rect className="loaf__rec-dot" x="96" y="20" width="12" height="12" rx="2" />}
      {state === 'requesting_mic' && (
        <g className="loaf__badge">
          <circle cx="102" cy="26" r="9" />
          <text x="102" y="30.5" textAnchor="middle">?</text>
        </g>
      )}
      {state === 'paused' && (
        <g className="loaf__pause">
          <rect x="96" y="18" width="4" height="14" rx="1.5" />
          <rect x="104" y="18" width="4" height="14" rx="1.5" />
        </g>
      )}
      {state === 'error' && (
        <g className="loaf__badge loaf__badge--warn">
          <circle cx="102" cy="26" r="9" />
          <text x="102" y="30.5" textAnchor="middle">!</text>
        </g>
      )}
      {state === 'ended' && (
        <g className="loaf__zz">
          <text x="94" y="30">z</text>
          <text x="103" y="20">z</text>
        </g>
      )}
    </g>
  );
}

interface StateAvatarProps {
  state: AvatarState;
  size?: 'sm' | 'md' | 'lg';
  /** Show the plain-text status next to the figure. */
  showLabel?: boolean;
  className?: string;
}

export function StateAvatar({ state, size = 'md', showLabel = false, className = '' }: StateAvatarProps) {
  const meta = ACTIVITY_META[state];
  return (
    <span className={`avatar avatar--${size} ${className}`} data-state={state}>
      <svg viewBox="0 0 120 100" className="avatar__svg" role="img" aria-label={`面包：${meta.label}`}>
        <LoafFigure state={state} />
      </svg>
      {showLabel && (
        <span className="avatar__label" aria-hidden="true">
          {meta.label}
        </span>
      )}
    </span>
  );
}
