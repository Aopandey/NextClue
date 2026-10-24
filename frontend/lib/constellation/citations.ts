import type { Source } from "@/lib/contracts";

export type Citation = {
  /** `publisher · title · location`, empty parts skipped; plain text. */
  text: string;
  /** The source url, or null when it is missing or not https. */
  href: string | null;
  /** "PMID n", an NCBI Bookshelf ID such as "NBK1292", or "PMID pending". */
  idLabel: string | null;
  idHref: string | null;
  /** "Search PubMed" link, only for PLACEHOLDER sources. */
  searchHref: string | null;
  unverified: boolean;
  /** The excerpt text with the unverified prefix stripped. */
  quote: string | null;
  location: string | null;
};

const UNVERIFIED_PREFIX = "[Unverified paraphrase] ";
const PLACEHOLDER = "PLACEHOLDER";
const NBK_ID = /\/books\/(NBK\d+)\//;

/** Removes a leading "[Unverified paraphrase] "; any other text is returned unchanged. */
export function stripUnverified(text: string): string {
  return text.startsWith(UNVERIFIED_PREFIX) ? text.slice(UNVERIFIED_PREFIX.length) : text;
}

const UNAVAILABLE: Citation = {
  text: "Source unavailable",
  href: null,
  idLabel: null,
  idHref: null,
  searchHref: null,
  unverified: false,
  quote: null,
  location: null,
};

function pubmedSearchHref(title: string): string | null {
  const term = title
    .slice(PLACEHOLDER.length)
    .replace(/^:/, "")
    .replace("(to be selected and verified)", "")
    .trim();
  return term ? `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(term)}` : null;
}

/** Citation line for one excerpt of a source. Never invents an ID; degrades to plain text. */
export function citationFor(source: Source | undefined, excerptId: string): Citation {
  if (!source) return { ...UNAVAILABLE };

  const excerpt = source.excerpts?.find((e) => e.excerpt_id === excerptId);
  const location = excerpt?.location?.trim() || null;
  const text = [source.publisher, source.title, location]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" · ");

  const url = source.url?.trim() ?? "";
  const href = /^https:\/\//i.test(url) ? url : null;
  const pmid = source.pmid?.trim() || null;
  const nbk = href?.match(NBK_ID)?.[1] ?? null;
  const title = source.title ?? "";

  let idLabel: string | null = null;
  let idHref: string | null = null;
  let searchHref: string | null = null;
  if (pmid) {
    idLabel = `PMID ${pmid}`;
    idHref = `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(pmid)}/`;
  } else if (nbk) {
    idLabel = nbk;
    idHref = href;
  } else if (title.startsWith(PLACEHOLDER)) {
    idLabel = "PMID pending";
    searchHref = pubmedSearchHref(title);
  }

  return {
    text,
    href,
    idLabel,
    idHref,
    searchHref,
    unverified: source.verification_status === "unverified",
    quote: excerpt ? stripUnverified(excerpt.text) : null,
    location,
  };
}

/** First clause (before " because ") of a claim, capped at `maxWords` words with "…". */
export function shortClaim(text: string, maxWords = 14): string {
  let claim = text;
  const because = claim.indexOf(" because ");
  if (because > 0) claim = `${claim.slice(0, because).replace(/[\s,;:]+$/, "")}.`;

  const words = claim.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return claim;
  return `${words.slice(0, maxWords).join(" ").replace(/[\s.,;:!?…]+$/, "")}…`;
}
