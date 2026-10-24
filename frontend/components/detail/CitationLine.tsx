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
          {c.unverified && (
            <span className={`${TAG} border border-[#f0c4aa] bg-[#fdf1ea] text-[10px] font-semibold uppercase tracking-[.06em] text-[var(--sig)]`}>
              Unverified paraphrase
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** One citation: the inline line by default, or the panel's `block`. */
export function CitationLine({ source, excerptId, variant = "inline" }: { source: Source | undefined; excerptId: string; variant?: "inline" | "block" }) {
  if (variant === "block") return <CitationBlock source={source} excerptId={excerptId} />;
  const c = citationFor(source, excerptId);
  const pending = c.idLabel === "PMID pending";
  return (
    <p data-testid="citation" className="text-[12.5px] text-[var(--mut)]">
      {pending ? (
        // Placeholder titles are not user copy: publisher, pending ID and a search link only.
        <span>{source?.publisher}</span>
      ) : c.href ? (
        <Ext href={c.href}>{c.text}</Ext>
      ) : (
        <span>{c.text}</span>
      )}
      {c.idLabel && (
        <>
          {" · "}
          {c.idHref ? (
            <Ext href={c.idHref} className="font-mono text-[12px]">
              {c.idLabel}
            </Ext>
          ) : (
            <span className="font-mono text-[12px]">{c.idLabel}</span>
          )}
        </>
      )}
      {c.searchHref && (
        <>
          {" · "}
          <Ext href={c.searchHref}>Search PubMed</Ext>
        </>
      )}
      {c.unverified && (
        <span className="ml-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--sig)]">
          Unverified paraphrase
        </span>
      )}
    </p>
  );
}
