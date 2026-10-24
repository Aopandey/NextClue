import type { Source } from "@/lib/contracts";
import { citationFor } from "@/lib/constellation/citations";

const LINK = "underline underline-offset-2 text-[var(--eye)]";

function Ext({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${LINK} ${className}`}>
      {children} ↗
    </a>
  );
}

const TAG = "rounded-[3px] px-1.5 py-px font-mono";

/** The panel's condensed Source block: publisher, one title link, then the ID tag and unverified badge. */
function CitationBlock({ source, excerptId }: { source: Source | undefined; excerptId: string }) {
  const c = citationFor(source, excerptId);
  const pending = c.idLabel === "PMID pending";
  const title = source?.title?.trim();
  // Without a real title (placeholder or no source) fall back to the joined text; pending shows the publisher only.
  const head = pending ? null : title ? <b className="font-semibold">{title}</b> : c.text;
  const where = !pending && title && c.location ? <span className="font-normal text-[var(--ink)]"> › {c.location}</span> : null;
  const line = head && (
    <>
      {head}
      {where}
    </>
  );
  return (
    <div data-testid="citation">
      <div className="hd">Source</div>
      {source?.publisher && <p className="text-[12px] text-[var(--mut)]">{source.publisher}</p>}
      {line &&
        (c.href ? (
          <p className="text-[13.5px]">
            <a href={c.href} target="_blank" rel="noopener noreferrer" className="text-[var(--eye)] no-underline hover:underline">
              {line}
              <span className="font-normal text-[var(--ink)]"> ↗</span>
            </a>
          </p>
        ) : (
          <p className="text-[13.5px] text-[var(--ink)]">{line}</p>
        ))}
      {(c.idLabel || c.unverified) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {c.idLabel &&
            (c.idHref ? (
              <a
                href={c.idHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`${TAG} border border-[#c9d6ec] bg-[#eef3fb] text-[11px] text-[var(--eye)] no-underline hover:underline`}
              >
                {c.idLabel} ↗
              </a>
            ) : (
              <span className={`${TAG} border border-[var(--line)] text-[11px] text-[var(--mut)]`}>{c.idLabel}</span>
            ))}
          {c.searchHref && (
            <Ext href={c.searchHref} className="text-[12px]">
              Search PubMed
            </Ext>
          )}
          {c.unverified && <UnverifiedBadge />}
        </div>
      )}
    </div>
  );
}

/** The unverified badge, shared by both variants. */
function UnverifiedBadge() {
  return (
    <span className={`${TAG} whitespace-nowrap border border-[#f0c4aa] bg-[#fdf1ea] text-[10px] font-semibold uppercase tracking-[.06em] text-[var(--sig)]`}>
      Unverified paraphrase
    </span>
  );
}

/** One line under a claim: publisher · location · ID link, then the unverified badge. */
function CitationShort({ source, excerptId }: { source: Source | undefined; excerptId: string }) {
  const c = citationFor(source, excerptId);
  const pending = c.idLabel === "PMID pending";
  // A trailing parenthetical is dropped: "GeneReviews (NCBI Bookshelf)" reads "GeneReviews".
  const publisher = source?.publisher?.replace(/\s*\([^)]*\)\s*$/, "").trim() || c.text;
  const parts: React.ReactNode[] = [publisher];
  if (!pending && c.location) parts.push(c.location);
  if (c.idLabel) {
    if (pending || !c.idHref) parts.push(c.idLabel);
    else parts.push(<Ext href={c.idHref} className="no-underline hover:underline">{c.idLabel}</Ext>);
  }
  if (c.searchHref) parts.push(<Ext href={c.searchHref} className="no-underline hover:underline">Search PubMed</Ext>);
  if (c.unverified) parts.push(<UnverifiedBadge />);
  return (
    <span data-testid="citation-short" className="mt-[3px] block text-[11.5px] text-[var(--mut)]">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {part}
        </span>
      ))}
    </span>
  );
}

/** One citation: the panel's `block`, or the one-line `short` under a claim. */
export function CitationLine({ source, excerptId, variant }: { source: Source | undefined; excerptId: string; variant: "block" | "short" }) {
  return variant === "block" ? <CitationBlock source={source} excerptId={excerptId} /> : <CitationShort source={source} excerptId={excerptId} />;
}
