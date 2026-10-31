'use client';

import { useDomId } from './hooks';

/**
 * 面包's mark: a small bun with glass-bead eyes, and the tuft on its head is a curl of red telephone
 * cord — the companion and the phone in one shape. Same paths as public/brand/*.svg and the favicon;
 * the 64-unit grid is shared, so the dial cap on the phone can print it too.
 */
export const BUN =
  'M32 14 C39.5 14 44.5 20.5 48 28.5 C52.5 38.5 56 45 55 51 C54 56.5 47 58.5 32 58.5 C17 58.5 10 56.5 9 51 C8 45 11.5 38.5 16 28.5 C19.5 20.5 24.5 14 32 14 Z';
export const CURL =
  'M31.8 14.6 C31 12 31.4 9.2 33.6 8.6 C35.6 8 36.6 10.2 35.2 11.2 C33.8 12.2 32.6 10 34.4 8 C36 6.2 38.4 5.2 39.8 6.6 C41 7.8 39.6 9.6 38.4 8.8 C37.2 8 38.4 5.6 40.6 4.8 C41.6 4.4 42.6 4.4 43.4 4.8';
export const BUN_EYES: [number, number][] = [
  [24.5, 38],
  [39.5, 38],
];

/** Hand-built lettering, 100-unit cells, drawn as round strokes so it needs no font. */
const MIAN = ['M10 12 H90', 'M50 12 L43 28', 'M17 30 V91', 'M17 30 H83 V91', 'M39 30 V91', 'M61 30 V91', 'M39 50 H61', 'M39 70 H61', 'M17 91 H83'];
const BAO = ['M38 8 Q34 22 16 36', 'M30 22 H82 Q86 22 86 27 V64 Q86 76 74 72', 'M32 40 H64 V58', 'M32 58 H64', 'M32 40 V80 Q32 91 43 91 H82 Q90 91 90 82'];

export function BrandMark({ className = '' }: { className?: string }) {
  const id = useDomId('mark');
  return (
    <svg viewBox="0 0 64 64" className={`brand-mark ${className}`} aria-hidden="true" focusable="false">
      <MarkArt id={id} />
    </svg>
  );
}

/** 面包 in round strokes. Takes `currentColor`, so it follows the page in light and dark. */
export function BrandType({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 78 40" className={`brand-type ${className}`} aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
        <g transform="translate(0 2) scale(0.38)">
          {MIAN.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <g transform="translate(40 2) scale(0.38)">
          {BAO.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </g>
    </svg>
  );
}

/** Mark + lettering, side by side. Decorative: the place that uses it keeps the name as text. */
export function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-logo ${className}`} aria-hidden="true">
      <BrandMark className="brand-logo__mark" />
      <BrandType className="brand-logo__type" />
    </span>
  );
}

function MarkArt({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-bun`} x1="0" y1="14" x2="0" y2="59" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FCF1DD" />
          <stop offset="0.5" stopColor="#F4DFBA" />
          <stop offset="0.78" stopColor="#DCA66D" />
          <stop offset="1" stopColor="#B97A44" />
        </linearGradient>
      </defs>
      <ellipse cx="22" cy="57.6" rx="6.4" ry="3.9" fill="#9C6234" />
      <ellipse cx="42" cy="57.6" rx="6.4" ry="3.9" fill="#9C6234" />
      <path d={BUN} fill={`url(#${id}-bun)`} stroke="#B07443" strokeWidth="1.5" />
      <ellipse cx="19.4" cy="44" rx="3.2" ry="1.8" fill="#FF8A76" opacity="0.4" />
      <ellipse cx="44.6" cy="44" rx="3.2" ry="1.8" fill="#FF8A76" opacity="0.4" />
      {BUN_EYES.map(([x, y]) => (
        <g key={x} transform={`translate(${x} ${y})`}>
          <ellipse rx="3.9" ry="4.2" fill="#241510" />
          <circle cx="-1.3" cy="-1.5" r="1.35" fill="#fff" />
          <circle cx="1.3" cy="1.5" r="0.6" fill="#fff" opacity="0.7" />
        </g>
      ))}
      <path d="M30 43.4 Q32 45.4 34 43.4" fill="none" stroke="#5A3220" strokeWidth="1.3" strokeLinecap="round" />
      <path d={CURL} fill="none" stroke="#C8322B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}
