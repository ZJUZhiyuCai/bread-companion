import { ACTIVITY_META, type AvatarState } from './labels';

type Face = 'content' | 'open' | 'thinking' | 'worried' | 'asleep';

const FACE_BY_STATE: Record<AvatarState, Face> = {
  idle: 'content',
  paused: 'content',
  ended: 'asleep',
  requesting_mic: 'open',
  recording: 'open',
  recorded: 'open',
  speaking: 'open',
  transcribing: 'thinking',
  generating: 'thinking',
  validating: 'thinking',
  error: 'worried',
};

/**
 * The loaf, drawn in a 120×100 box. Shared by the presence on the composer and the lamp scenes,
 * so the bread under the lamp is the same character that talks to you.
 */
export function LoafFigure({ state }: { state: AvatarState }) {
  const face = FACE_BY_STATE[state];
  const speaking = state === 'speaking';
  return (
    <g className="loaf" data-state={state}>
      <ellipse className="loaf__shadow" cx="60" cy="90" rx="42" ry="4.5" />
      <g className="loaf__body">
        <path
          className="loaf__crust"
          d="M12 72 C12 44 33 24 60 24 C87 24 108 44 108 72 C108 83 100 87 89 87 L31 87 C20 87 12 83 12 72 Z"
        />
        <path className="loaf__crumb" d="M22 74 C22 52 39 36 60 36 C81 36 98 52 98 74 C98 80 93 82 86 82 L34 82 C27 82 22 80 22 74 Z" />
        <g className="loaf__scores">
          <path d="M36 33 q8 -7 17 -6" />
          <path d="M55 28 q8 -4 16 -2" />
          <path d="M73 31 q7 -1 12 3" />
        </g>
        <g className="loaf__face">
          {face === 'content' && (
            <>
              <path d="M42 60 q5 -5 10 0" />
              <path d="M68 60 q5 -5 10 0" />
            </>
          )}
          {face === 'open' && (
            <g className="loaf__eyes">
              <ellipse cx="47" cy="59" rx="3.2" ry="3.6" className="loaf__eye" />
              <ellipse cx="73" cy="59" rx="3.2" ry="3.6" className="loaf__eye" />
              <circle cx="48.2" cy="57.6" r="1" className="loaf__glint" />
              <circle cx="74.2" cy="57.6" r="1" className="loaf__glint" />
            </g>
          )}
          {face === 'thinking' && (
            <>
              <circle cx="49" cy="56" r="2.8" className="loaf__eye" />
              <circle cx="75" cy="56" r="2.8" className="loaf__eye" />
            </>
          )}
          {face === 'worried' && (
            <>
              <path d="M41 52 l9 2.5" />
              <path d="M79 52 l-9 2.5" />
              <circle cx="47" cy="60" r="2.6" className="loaf__eye" />
              <circle cx="73" cy="60" r="2.6" className="loaf__eye" />
            </>
          )}
          {face === 'asleep' && (
            <>
              <path d="M42 60 q5 4 10 0" />
              <path d="M68 60 q5 4 10 0" />
            </>
          )}
          {speaking ? (
            <ellipse className="loaf__mouth" cx="60" cy="69" rx="4" ry="3" />
          ) : face === 'worried' ? (
            <path d="M55 71 q5 -3 10 0" />
          ) : face === 'thinking' ? (
            <path d="M57 69 h6" />
          ) : (
            <path d="M55 67 q5 4.5 10 0" />
          )}
        </g>
        <ellipse className="loaf__cheek" cx="36" cy="67" rx="5" ry="3.4" />
        <ellipse className="loaf__cheek" cx="84" cy="67" rx="5" ry="3.4" />
      </g>

      {speaking && (
        <g className="loaf__steam">
          <path d="M46 18 c-5 -5 5 -9 0 -15" />
          <path d="M60 15 c-5 -5 5 -9 0 -15" />
          <path d="M74 18 c-5 -5 5 -9 0 -15" />
        </g>
      )}
      {(state === 'generating' || state === 'validating' || state === 'transcribing') && (
        <g className="loaf__flour">
          <circle cx="44" cy="14" r="2.4" />
          <circle cx="60" cy="9" r="2.4" />
          <circle cx="76" cy="14" r="2.4" />
        </g>
      )}
      {state === 'recording' && (
        <g className="loaf__rec">
          <circle className="loaf__rec-ring" cx="104" cy="26" r="10" />
          <circle className="loaf__rec-dot" cx="104" cy="26" r="6" />
        </g>
      )}
      {state === 'recorded' && <rect className="loaf__rec-dot" x="98" y="20" width="12" height="12" rx="2.5" />}
      {state === 'requesting_mic' && (
        <g className="loaf__badge">
          <circle cx="104" cy="26" r="9.5" />
          <text x="104" y="30.5" textAnchor="middle">?</text>
        </g>
      )}
      {state === 'paused' && (
        <g className="loaf__pause">
          <rect x="97" y="18" width="4.5" height="15" rx="1.6" />
          <rect x="106" y="18" width="4.5" height="15" rx="1.6" />
        </g>
      )}
      {state === 'error' && (
        <g className="loaf__badge loaf__badge--warn">
          <circle cx="104" cy="26" r="9.5" />
          <text x="104" y="30.5" textAnchor="middle">!</text>
        </g>
      )}
      {state === 'ended' && (
        <g className="loaf__zz">
          <text x="94" y="30">z</text>
          <text x="104" y="19">z</text>
        </g>
      )}
    </g>
  );
}

interface StateAvatarProps {
  state: AvatarState;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Decorative copies (e.g. next to every message) stay out of the accessibility tree. */
  decorative?: boolean;
  className?: string;
}

export function StateAvatar({ state, size = 'md', decorative = false, className = '' }: StateAvatarProps) {
  return (
    <span className={`avatar avatar--${size} ${className}`} data-state={state}>
      <svg
        viewBox="0 0 120 100"
        className="avatar__svg"
        {...(decorative
          ? { 'aria-hidden': true, focusable: false }
          : { role: 'img', 'aria-label': `面包：${ACTIVITY_META[state].label}` })}
      >
        <LoafFigure state={state} />
      </svg>
    </span>
  );
}
