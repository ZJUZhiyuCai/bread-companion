import { History, Quote, TriangleAlert } from 'lucide-react';
import type { EvidenceView } from './labels';
import { ORIGIN_META } from './labels';

/** One cited excerpt. The quote text is rendered verbatim — never rephrased by the UI. */
export function EvidenceQuote({ ev, onOpenSource }: { ev: EvidenceView; onOpenSource?: (id: string) => void }) {
  const flagged = ev.outdated || ev.missing || ev.confirmed === false;
  return (
    <figure className={`quote ${flagged ? 'quote--flagged' : ''} ${ev.outdated ? 'quote--outdated' : ''}`}>
      <blockquote className="quote__text">
        <Quote aria-hidden="true" className="quote__mark" />
        {ev.quote}
      </blockquote>
      <figcaption className="quote__cap">
        {onOpenSource && !ev.missing ? (
          <button type="button" className="link-btn" onClick={() => onOpenSource(ev.sourceId)}>
            {ev.label}
          </button>
        ) : (
          <span>{ev.label}</span>
        )}
        {ev.origin && ev.label !== ORIGIN_META[ev.origin].label && <span> · {ORIGIN_META[ev.origin].label}</span>}
        <span> · 第 {ev.sourceRevision} 版</span>
        {ev.confirmed === false && (
          <span className="flag">
            <TriangleAlert aria-hidden="true" /> 来源待确认归属
          </span>
        )}
        {ev.outdated && (
          <span className="flag">
            <History aria-hidden="true" /> 来源已修正，这段引用已过期
          </span>
        )}
        {ev.missing && (
          <span className="flag">
            <TriangleAlert aria-hidden="true" /> 找不到对应来源
          </span>
        )}
      </figcaption>
    </figure>
  );
}
