'use client';

import { useEffect, useId, useLayoutEffect, useState, type RefObject } from 'react';

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
