'use client';

import { useEffect, useId, useLayoutEffect, useState, type RefObject } from 'react';
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
