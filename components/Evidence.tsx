import { History, TriangleAlert } from 'lucide-react';
import type { EvidenceView } from './labels';
import { ORIGIN_META } from './labels';

/** One cited excerpt. The quote is rendered verbatim — the UI never rephrases it. */
export function EvidenceQuote({ ev, onOpenSource }: { ev: EvidenceView; onOpenSource?: (id: string) => void }) {
  const flagged = ev.outdated || ev.missing || ev.confirmed === false;
  const originLabel = ev.origin ? ORIGIN_META[ev.origin].label : null;
  return (
    <figure className={`quote ${flagged ? 'is-flagged' : ''} ${ev.outdated ? 'is-outdated' : ''}`}>
      <blockquote className="quote__text">{ev.quote}</blockquote>
      <figcaption className="quote__cap">
        <span aria-hidden="true">—— </span>
        {onOpenSource && !ev.missing ? (
          <button type="button" className="text-btn text-btn--inline" onClick={() => onOpenSource(ev.sourceId)}>
            {ev.label}
            <span className="sr-only">，打开这段材料</span>
          </button>
        ) : (
          <span>{ev.label}</span>
        )}
        {originLabel && ev.label !== originLabel && <span> · {originLabel}</span>}
        {ev.sourceRevision > 1 && <span> · 第 {ev.sourceRevision} 版</span>}
        {ev.confirmed === false && (
          <span className="flag">
            <TriangleAlert aria-hidden="true" /> 这段材料还没经你确认
          </span>
        )}
        {ev.outdated && (
          <span className="flag">
            <History aria-hidden="true" /> 你后来改过这段材料，这句引用已过期
          </span>
        )}
        {ev.missing && (
          <span className="flag">
            <TriangleAlert aria-hidden="true" /> 找不到对应的材料
          </span>
        )}
      </figcaption>
    </figure>
  );
}
