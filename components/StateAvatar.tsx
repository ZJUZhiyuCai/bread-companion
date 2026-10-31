import { BreadBuddy, BreadMark } from './BreadBuddy';
import { buddyForActivity } from './call';
import { ACTIVITY_META, type AvatarState } from './labels';

interface StateAvatarProps {
  state: AvatarState;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Decorative copies (e.g. next to every message) stay out of the accessibility tree. */
  decorative?: boolean;
  className?: string;
}

/** The same 面包 everywhere: full figure from sm up, just the face at xs. */
export function StateAvatar({ state, size = 'md', decorative = false, className = '' }: StateAvatarProps) {
  const label = decorative ? undefined : `面包：${ACTIVITY_META[state].label}`;
  if (size === 'xs') {
    const mark =
      state === 'speaking'
        ? 'speaking'
        : state === 'generating' || state === 'validating' || state === 'transcribing'
          ? 'thinking'
          : state === 'ended'
            ? 'asleep'
            : 'idle';
    return (
      <span className={`avatar avatar--xs ${className}`} data-state={state} role={label ? 'img' : undefined} aria-label={label}>
        <BreadMark state={mark} />
      </span>
    );
  }
  return (
    <span className={`avatar avatar--${size} ${className}`} data-state={state}>
      <BreadBuddy state={buddyForActivity(state)} label={label} decorative={decorative} />
    </span>
  );
}
