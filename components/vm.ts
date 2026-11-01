import type { BreadViewModel } from '@/domain/view-model';

export type AssistMode = 'organize' | 'review' | 'practice';

/**
 * The view model plus the convenience calls Codex adds this round.
 * Once domain/view-model.ts declares them, this intersection is a no-op.
 */
export type BreadVM = BreadViewModel & {
  /** One tap: organize = leave a note from what was said, review = look at an answer, practice = agent picks a question. */
  assist: (mode: AssistMode, direction?: string) => Promise<void>;
  /** One box: recorded as user-provided material (not externally verified). */
  addMaterial: (text: string) => boolean;
  /** The last text turn failed and can be sent again as-is; false once anything has changed since. */
  canRetry?: boolean;
  /** Re-runs that turn without recording the user's line a second time. */
  retryLastTurn?: () => Promise<void>;
};
