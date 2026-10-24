import { describe, expect, it } from "vitest";
import sourcesJson from "@/fixtures/sources.json";
import type { Source } from "@/lib/contracts";
import { citationFor, shortClaim, stripUnverified } from "../citations";

const sources = sourcesJson as Record<string, Source>;

const srcBase: Source = {
  source_id: "src-base",
  source_type: "pubmed",
  title: "A review",
  publisher: "PubMed",
  year: null,
  url: "https://pubmed.ncbi.nlm.nih.gov/",
  pmid: null,
  excerpts: [{ excerpt_id: "e1", text: "[Unverified paraphrase] A paraphrased point.", location: null }],
  verification_status: "verified",
  retrieved_on: null,
};

describe("citationFor", () => {
  it("GeneReviews citation uses NBK id, no PMID", () => expect(citationFor(sources["src-genereviews-fabry"], "exc-fabry-female-enzyme")).toMatchObject({ text:"GeneReviews (NCBI Bookshelf) · Fabry Disease · Diagnosis", href:"https://www.ncbi.nlm.nih.gov/books/NBK1292/", idLabel:"NBK1292", idHref:"https://www.ncbi.nlm.nih.gov/books/NBK1292/", unverified:true }));

  it("placeholder PubMed source says PMID pending and offers search", () => { const c = citationFor(sources["src-sfn-review"], "exc-sfn-causes"); expect(c.idLabel).toBe("PMID pending"); expect(c.idHref).toBeNull(); expect(c.searchHref).toMatch(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\?term=/); });

  it("real pmid links to PubMed", () => expect(citationFor({ ...srcBase, pmid:"12345678" }, "e1").idHref).toBe("https://pubmed.ncbi.nlm.nih.gov/12345678/"));

  it("degrades without url, pmid or excerpt and never prints undefined", () => { const c = citationFor({ ...srcBase, url:"", pmid:null, title:"Some review" }, "missing"); expect(c.href).toBeNull(); expect(c.quote).toBeNull(); expect(JSON.stringify(c)).not.toContain("undefined"); });

  it("citationFor(undefined) returns a 'Source unavailable' text", () => expect(citationFor(undefined,"e").text).toBe("Source unavailable"));

  it("non-placeholder source with no url and no pmid is plain publisher · title with no links", () =>
    expect(citationFor({ ...srcBase, url: "", pmid: null, title: "Some review" }, "missing")).toEqual({
      text: "PubMed · Some review",
      href: null,
      idLabel: null,
      idHref: null,
      searchHref: null,
      unverified: false,
      quote: null,
      location: null,
    }));

  it("excerpt missing from the source keeps the source link but drops quote and location", () =>
    expect(citationFor(sources["src-genereviews-fabry"], "exc-not-there")).toMatchObject({
      text: "GeneReviews (NCBI Bookshelf) · Fabry Disease",
      href: "https://www.ncbi.nlm.nih.gov/books/NBK1292/",
      quote: null,
      location: null,
    }));

  it("quote and location come from the matched excerpt with the unverified prefix stripped", () => {
    const c = citationFor(sources["src-genereviews-fabry"], "exc-fabry-female-enzyme");
    expect(c.quote).toBe(
      "In females heterozygous for a GLA pathogenic variant, alpha-galactosidase A enzyme activity may be within the normal range, so molecular genetic testing of GLA is needed to identify heterozygotes.",
    );
    expect(c.location).toBe("Diagnosis");
  });

  it("does not link a url that is not https", () => {
    const c = citationFor({ ...srcBase, url: "javascript:alert(1)" }, "e1");
    expect(c.href).toBeNull();
    expect(c.text).toBe("PubMed · A review");
  });

  it("unavailable source has no links, quote or location", () =>
    expect(citationFor(undefined, "e")).toEqual({
      text: "Source unavailable",
      href: null,
      idLabel: null,
      idHref: null,
      searchHref: null,
      unverified: false,
      quote: null,
      location: null,
    }));
});

describe("shortClaim", () => {
  it("shortClaim cuts at ' because ' then 14 words", () => {
    expect(shortClaim("A normal enzyme result does not exclude Fabry disease in a woman, because heterozygous females can have enzyme activity in the normal range.")).toBe("A normal enzyme result does not exclude Fabry disease in a woman.");
    expect(shortClaim("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen")).toBe("one two three four five six seven eight nine ten eleven twelve thirteen fourteen…");
  });
});

describe("stripUnverified", () => {
  it("strips the unverified prefix", () => expect(stripUnverified("[Unverified paraphrase] In females…")).toBe("In females…"));
});
