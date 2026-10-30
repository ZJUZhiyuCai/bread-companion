'use client';

import { useEffect, useId, useState } from 'react';

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
