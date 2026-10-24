"""Evidence curation CLI. Run from the repo root.

  python -m ai.evidence_tool search "small fiber neuropathy causes" [--max 10]
  python -m ai.evidence_tool show 29112785
  python -m ai.evidence_tool add 29112785 --source-id src-x --excerpt-id exc-x \
      --text "exact abstract sentence" --evidence-version evidence-YYYY-MM-DD.N
  python -m ai.evidence_tool genereviews-copy fabry --out $env:TEMP\nextclue-review
  python -m ai.evidence_tool check [--online] [--fulltext src-id=path.nxml]

Search results are candidates only; nothing found here reaches a run until it is
registered in backend/data/sources.json and seeded. `add` writes an excerpt only
if it is verbatim in PubMed, always as unverified. A reviewer marks a source
verified by hand after reading it, then bumps evidence_version and re-seeds.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.contracts import SourceRegistry  # noqa: E402

from ai import pubmed  # noqa: E402
from ai.retrieval import PLACEHOLDER  # noqa: E402

REGISTRY_PATH = BACKEND_DIR / "data" / "sources.json"
_PMC = re.compile(r"\bPMC\d+\b")


def load_registry(path: Path = REGISTRY_PATH) -> SourceRegistry:
    return SourceRegistry.model_validate_json(path.read_text(encoding="utf-8"))


def offline_problems(registry: SourceRegistry) -> list[str]:
    """Structural checks that need no network. Any problem blocks seeding a reviewed registry."""
    problems: list[str] = []
    seen_sources: set[str] = set()
    seen_excerpts: set[str] = set()
    if not registry.evidence_version.strip() or "draft" in registry.evidence_version:
        problems.append(f"evidence_version {registry.evidence_version!r} looks like a draft")
    for s in registry.sources:
        if s.source_id in seen_sources:
            problems.append(f"duplicate source id {s.source_id}")
        seen_sources.add(s.source_id)
        for e in s.excerpts:
            if e.excerpt_id in seen_excerpts:
                problems.append(f"duplicate excerpt id {e.excerpt_id}")
            seen_excerpts.add(e.excerpt_id)
        if s.verification_status != "verified":
            continue
        where = s.source_id
        if PLACEHOLDER.search(s.title) or any(PLACEHOLDER.search(e.text) for e in s.excerpts):
            problems.append(f"{where}: verified source still contains placeholder text")
        if not s.retrieved_on:
            problems.append(f"{where}: verified source needs retrieved_on")
        if s.source_type == "pubmed":
            if not s.pmid:
                problems.append(f"{where}: pubmed source needs a PMID")
            elif s.url != f"https://pubmed.ncbi.nlm.nih.gov/{s.pmid}/":
                problems.append(f"{where}: url does not match PMID {s.pmid}")
        if s.pmid and not re.fullmatch(r"\d{1,9}", s.pmid):
            problems.append(f"{where}: malformed PMID {s.pmid!r}")
        if any(not e.text.strip() for e in s.excerpts):
            problems.append(f"{where}: blank excerpt")
    return problems


def _xml_text(data: bytes) -> str:
    """Paragraph texts, each joined without separators so inline citations stay intact."""
    root = ET.fromstring(data)
    body = root.find(".//body")
    scope = body if body is not None else root
    blocks = [p for p in scope.iter() if p.tag in ("p", "title", "td", "th")]
    return "\n".join(pubmed.normalize("".join(p.itertext())) for p in blocks)


def _pmc_text(pmcid: str) -> str:
    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" + urllib.parse.urlencode(
        {"db": "pmc", "id": pmcid.removeprefix("PMC"), "retmode": "xml", "tool": "nextclue"})
    request = urllib.request.Request(url, headers={"User-Agent": "NextClue/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return _xml_text(response.read())
    except Exception as exc:  # noqa: BLE001 - report without URLs
        raise pubmed.PubMedError(f"PMC full-text fetch failed ({type(exc).__name__}).") from None


def online_report(registry: SourceRegistry, fulltext: dict[str, Path]) -> tuple[list[str], list[str]]:
    """Check each verified excerpt is verbatim in PubMed, PMC, or a supplied review copy."""
    lines: list[str] = []
    problems: list[str] = []
    verified = [s for s in registry.sources if s.verification_status == "verified"]
    known = {s.source_id for s in verified}
    local_text = {}
    # Validate all supplied copies before any online requests. A typo must not
    # silently skip the file, even if abstracts happen to cover the excerpts.
    for source_id, path in fulltext.items():
        if source_id not in known:
            raise ValueError(f"Verification incomplete: unknown or unverified source ID {source_id!r}.")
        try:
            local_text[source_id] = pubmed.normalize(_xml_text(path.read_bytes()))
        except OSError as exc:
            raise ValueError(
                f"Verification incomplete: cannot read review copy for {source_id} ({type(exc).__name__})."
            ) from None
        except ET.ParseError:
            raise ValueError(f"Verification incomplete: review copy for {source_id} is invalid XML.") from None
    records = {r.pmid: r for r in pubmed.fetch([s.pmid for s in verified if s.pmid])}
    for s in verified:
        record = records.get(s.pmid or "")
        if s.pmid and record is None:
            problems.append(f"{s.source_id}: PMID {s.pmid} not found in PubMed")
            continue
        if record is not None:
            lines.append(f"{s.source_id}: PMID {s.pmid} = {record.title!r} ({record.journal}, {record.year})")
            if pubmed.normalize(s.title).rstrip(".").lower() not in record.title.rstrip(".").lower():
                problems.append(f"{s.source_id}: title does not match PubMed title")
        local = local_text.get(s.source_id, "")
        pmc_cache: dict[str, str] = {}
        for e in s.excerpts:
            needle = pubmed.normalize(e.text)
            where = record.locate(e.text) if record is not None else None
            if where:
                lines.append(f"  ok  {e.excerpt_id}: PubMed {where}")
                continue
            if local and needle in local:
                lines.append(f"  ok  {e.excerpt_id}: review copy {fulltext[s.source_id].name}")
                continue
            pmc = _PMC.search(e.location or "")
            if pmc:
                if pmc.group(0) not in pmc_cache:
                    pmc_cache[pmc.group(0)] = _pmc_text(pmc.group(0))
                if needle in pmc_cache[pmc.group(0)]:
                    lines.append(f"  ok  {e.excerpt_id}: {pmc.group(0)} full text")
                    continue
            if s.source_id in fulltext or pmc or (e.location or "").startswith(("Abstract", "Title", "Summary")):
                problems.append(f"{s.source_id}/{e.excerpt_id}: not verbatim in the checked original")
            else:
                lines.append(f"  --  {e.excerpt_id}: needs a review copy (--fulltext {s.source_id}=PATH)")
                problems.append(
                    f"{s.source_id}/{e.excerpt_id}: verification incomplete; supply the original review copy"
                )
    return lines, problems


def cmd_search(args: argparse.Namespace) -> int:
    pmids = pubmed.search(args.query, retmax=args.max)
    registered = {s.pmid: s.source_id for s in load_registry().sources if s.pmid}
    for r in pubmed.fetch(pmids):
        tag = f"registered as {registered[r.pmid]}" if r.pmid in registered else "candidate, unregistered"
        print(f"{r.pmid} | {r.year} | {r.journal} | {r.title} [{tag}]")
    print("Candidates are not evidence until reviewed and registered.")
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    for r in pubmed.fetch([args.pmid]):
        print(f"PMID {r.pmid} | {r.year} | {r.journal}\n{r.title}\n{', '.join(r.authors[:6])}")
        print(f"Types: {', '.join(r.publication_types)} | DOI {r.doi} | {r.pmcid or 'no PMC'}\n{r.url}\n")
        print(r.abstract or "(no abstract in PubMed)")
        return 0
    print(f"PMID {args.pmid} not found.")
    return 1


def cmd_add(args: argparse.Namespace) -> int:
    records = pubmed.fetch([args.pmid])
    if not records:
        print(f"PMID {args.pmid} not found; nothing written.")
        return 1
    record = records[0]
    where = record.locate(args.text)
    if where is None:
        print("Excerpt is not verbatim in the PubMed title/abstract; nothing written.")
        return 1
    data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
    if args.evidence_version == data["evidence_version"]:
        print("Choose a new evidence_version; registry content is changing.")
        return 1
    if any(e["excerpt_id"] == args.excerpt_id for s in data["sources"] for e in s["excerpts"]):
        print(f"{args.excerpt_id} already exists; IDs are never reused.")
        return 1
    source = next((s for s in data["sources"] if s["source_id"] == args.source_id), None)
    if source is None:
        source = {
            "source_id": args.source_id, "source_type": "pubmed", "title": record.title.rstrip("."),
            "publisher": record.journal, "year": record.year, "url": record.url, "pmid": record.pmid,
            "excerpts": [], "verification_status": "unverified", "retrieved_on": None,
        }
        data["sources"].append(source)
    elif source.get("pmid") != record.pmid:
        print(f"{args.source_id} is registered with a different PMID; nothing written.")
        return 1
    source["excerpts"].append({"excerpt_id": args.excerpt_id, "text": args.text, "location": where})
    # New text is always unreviewed, even when added to a reviewed source.
    source["verification_status"] = "unverified"
    data["evidence_version"] = args.evidence_version
    SourceRegistry.model_validate(data)
    REGISTRY_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Added {args.excerpt_id} ({where}) to {args.source_id} as UNVERIFIED; "
          f"evidence_version={args.evidence_version}. Review it, then re-seed.")
    return 0


GENEREVIEWS_ARCHIVE = "https://ftp.ncbi.nlm.nih.gov/pub/litarch/ca/84/gene_NBK1116.tar.gz"


def cmd_genereviews_copy(args: argparse.Namespace) -> int:
    """Stream NCBI's GeneReviews archive (~640 MB) and keep one chapter's XML.

    The Bookshelf web page sits behind a browser check, so review copies come
    from NCBI's literature archive. Only the named chapter is written; the
    archive itself is never stored. Keep the copy outside the repository.
    """
    import hashlib
    import tarfile

    if not re.fullmatch(r"[a-z0-9-]+", args.shortname):
        print("Shortname must be lowercase letters, digits, or hyphens (e.g. fabry).")
        return 1
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    wanted = f"gene_NBK1116/{args.shortname}.nxml"
    request = urllib.request.Request(GENEREVIEWS_ARCHIVE, headers={"User-Agent": "NextClue/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, \
                tarfile.open(fileobj=response, mode="r|gz") as archive:
            for member in archive:
                if member.isfile() and member.name == wanted:
                    data = archive.extractfile(member).read()
                    target = out / f"{args.shortname}.nxml"
                    target.write_bytes(data)
                    print(f"Wrote {target} ({len(data)} bytes, sha256 {hashlib.sha256(data).hexdigest()}).")
                    return 0
    except (OSError, tarfile.TarError) as exc:
        print(f"GeneReviews archive download failed ({type(exc).__name__}).")
        return 1
    print(f"{wanted} not found in the archive.")
    return 1


def cmd_check(args: argparse.Namespace) -> int:
    registry = load_registry()
    verified = [s for s in registry.sources if s.verification_status == "verified"]
    print(f"Registry {registry.evidence_version}: {len(verified)}/{len(registry.sources)} sources verified, "
          f"{sum(len(s.excerpts) for s in verified)} verified excerpts.")
    problems = offline_problems(registry)
    if args.fulltext and not args.online:
        raise ValueError("Verification incomplete: --fulltext requires --online.")
    if args.online:
        fulltext: dict[str, Path] = {}
        for item in args.fulltext:
            source_id, separator, path = item.partition("=")
            source_id, path = source_id.strip(), path.strip()
            if not separator or not source_id or not path:
                raise ValueError("Verification incomplete: --fulltext must use SOURCE_ID=PATH.")
            if source_id in fulltext:
                raise ValueError(f"Verification incomplete: duplicate review copy for {source_id}.")
            fulltext[source_id] = Path(path)
        lines, online = online_report(registry, fulltext)
        print("\n".join(lines))
        problems += online
    for p in problems:
        print(f"PROBLEM: {p}")
    print("Check passed." if not problems else f"{len(problems)} problem(s).")
    return 1 if problems else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="NextClue evidence registry curation.")
    sub = parser.add_subparsers(dest="command", required=True)
    s = sub.add_parser("search", help="List candidate PMIDs (not registered).")
    s.add_argument("query")
    s.add_argument("--max", type=int, default=10)
    s.set_defaults(func=cmd_search)
    s = sub.add_parser("show", help="Print exact PubMed title and abstract.")
    s.add_argument("pmid")
    s.set_defaults(func=cmd_show)
    s = sub.add_parser("add", help="Register a verbatim abstract excerpt as unverified.")
    s.add_argument("pmid")
    s.add_argument("--source-id", required=True)
    s.add_argument("--excerpt-id", required=True)
    s.add_argument("--text", required=True)
    s.add_argument("--evidence-version", required=True)
    s.set_defaults(func=cmd_add)
    s = sub.add_parser("genereviews-copy", help="Save one GeneReviews chapter XML for review.")
    s.add_argument("shortname", help="Chapter shortname, e.g. fabry")
    s.add_argument("--out", required=True, help="Folder outside the repository")
    s.set_defaults(func=cmd_genereviews_copy)
    s = sub.add_parser("check", help="Validate the registry; --online re-checks quotes.")
    s.add_argument("--online", action="store_true")
    s.add_argument("--fulltext", action="append", default=[], metavar="SOURCE_ID=PATH")
    s.set_defaults(func=cmd_check)
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (pubmed.PubMedError, ValueError) as exc:
        print(f"Evidence tool: {exc}")
        return 1
    except (OSError, ET.ParseError) as exc:
        print(f"Evidence tool: verification incomplete ({type(exc).__name__}).")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
