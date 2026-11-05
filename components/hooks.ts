'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => {
    ready: Promise<void>;
    finished: Promise<void>;
    updateCallbackDone: Promise<void>;
  };
};

/**
 * Moves from one view to the next as one continuous shot where the browser can: 面包, its phone and
 * the name glide from where they were to where they are now (view-transition-name in the CSS), and the
 * rest of the room cross-fades. Elsewhere — or with reduced motion — the update simply happens.
 *
 * The browser shows the old view for one more frame before the update runs, so this is only for
 * steps that start nothing time-sensitive: never a call, a hang-up, audio or anything that stops work
 * in progress. `keyboard` marks a step whose new view focuses a text field: on touch screens that has
 * to happen inside the tap to bring up the keyboard, so there it is not deferred at all.
 *
 * While it runs the transition takes no pointer (see ::view-transition), so the new view underneath
 * is usable from its first frame.
 */
export function morph(update: () => void, { keyboard = false }: { keyboard?: boolean } = {}): void {
  const doc = typeof document === 'undefined' ? null : (document as ViewTransitionDocument);
  if (
    !doc?.startViewTransition ||
    doc.visibilityState !== 'visible' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    (keyboard && window.matchMedia('(pointer: coarse)').matches)
  ) {
    update();
    return;
  }
  let ran = false;
  try {
    const t = doc.startViewTransition(() => {
      ran = true;
      flushSync(update);
    });
    // A skipped transition (e.g. a duplicate name) is not an error for the person; the update still ran.
    t.ready.catch(() => undefined);
    t.finished.catch(() => undefined);
    t.updateCallbackDone.catch((err: unknown) => window.reportError?.(err));
  } catch {
    if (!ran) update();
  }
}

/**
 * Reads the real value on first client render. Only use in views that are never server-rendered
 * (everything after the entry screen), otherwise hydration could mismatch.
 */
export function useMediaQuery(query: string, initial = false): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? initial : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [query]);
  return matches;
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** useId output contains colons; make it safe for CSS selectors and anchors. */
export function useDomId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export function anyDialogOpen(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('dialog[open]');
}

/** True for `ms` after mount (when `on`), then false. Same first render on server and client. */
export function useFlash(on: boolean, ms: number): boolean {
  const [flash, setFlash] = useState(on);
  useEffect(() => {
    if (!on) return;
    const t = window.setTimeout(() => setFlash(false), ms);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return flash;
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** How long a replaced line stays on as an afterimage. Longer than its fade (line-out in the CSS). */
const AFTERIMAGE_MS = 420;
/** A line that was up for less than this never becomes an afterimage: it was a flicker, not a line. */
const AFTERIMAGE_SETTLE_MS = 260;

/**
 * The line that was just replaced, for as long as it takes to fade, so that a change of words is one
 * line giving way to the next in place instead of a cut with a blank frame between them.
 *
 * The current value is never held back — it renders at once, exactly as the state says. This only adds
 * a decorative, aria-hidden copy of the previous one. A state that passes through for a frame or two
 * (clearing the box just before a reply starts) is never kept as an afterimage, so it never shows at
 * all: the line before it simply keeps fading. `key` says when the words changed; `value` is whatever
 * the afterimage needs to be drawn the way it was (its text, its tone).
 */
export function useAfterimage<T>(value: T, key: string): { value: T; n: number } | null {
  const [ghost, setGhost] = useState<{ value: T; key: string; n: number } | null>(null);
  const shown = useRef({ value, key, since: 0 });
  const timer = useRef(0);
  // Before paint, so the old line is never missing for a frame.
  useIsoLayoutEffect(() => {
    const cur = shown.current;
    if (cur.key === key) {
      cur.value = value;
      return;
    }
    const now = performance.now();
    if (now - cur.since >= AFTERIMAGE_SETTLE_MS) {
      setGhost((g) => ({ value: cur.value, key: cur.key, n: (g?.n ?? 0) + 1 }));
    }
    shown.current = { value, key, since: now };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setGhost(null), AFTERIMAGE_MS);
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // Back to the words already fading out: show them once, not twice.
  return ghost && ghost.key !== key ? { value: ghost.value, n: ghost.n } : null;
}

/** Textarea grows with its content up to `maxPx`, then scrolls. */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx = 220) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden';
  }, [ref, value, maxPx]);
}
