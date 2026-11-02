'use client';

import { BreadMark } from './BreadBuddy';

/**
 * 面包's mark is 面包: a round portrait cut from the same plush photo the rest of the page uses, with the
 * same glass eyes — the picture a phone shows for someone you call. The name beside it is set in 面包's
 * own face (Bread Voice), at the one weight it really has. No drawn second character, no font of its own.
 *
 * The static files in public/brand and the favicon carry the plush's silhouette instead, for places a
 * photo can't go (16px tabs, single-colour print).
 */

/** The silhouette on the 64-unit grid shared with public/brand/*.svg and the favicon. */
export const BUN =
  'M32.5 9 C35.5 12.5 41 18.5 45.5 26 C50.5 34.5 55 42 55 49.5 C55 56 47 59 32 59 C17 59 9 56 9 49.5 C9 42 13.5 34.5 18.5 26 C23 18.5 29.5 12.5 32.5 9 Z';
/** Retired: the telephone-cord tuft. Kept as an export for anything outside this set that still imports it. */
export const CURL = '';
/** Where the glass eyes sit on that silhouette, measured from the photo (as in the static files). */
export const BUN_EYES: [number, number][] = [
  [23.4, 34],
  [41.6, 34],
];

/** The portrait. Decorative: wherever it appears, the name is said in text next to it. */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <span className="brand-mark__face">
        <BreadMark />
      </span>
    </span>
  );
}

/** 面包, in its own hand. Takes the page's ink, so it follows light and dark. */
export function BrandType({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-type ${className}`} aria-hidden="true">
      面包
    </span>
  );
}

/** Portrait + name, side by side. Decorative: the place that uses it keeps the name as text. */
export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`} aria-hidden="true">
      <BrandMark className="brand-logo__mark" />
      <BrandType className="brand-logo__type" />
    </span>
  );
}
