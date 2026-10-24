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

/** One citation line: source text, ID link, PubMed search for placeholders, unverified label. */
export function CitationLine({ source, excerptId }: { source: Source | undefined; excerptId: string }) {
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
