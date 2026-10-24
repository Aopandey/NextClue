"""Bounded PubMed E-utilities client with cancellable HTTP requests.

Two uses, both bounded:
  * Curation: search/fetch real PMIDs so a reviewer can register exact excerpts
    (see ai/evidence_tool.py). Nothing found here is citable until registered.
  * Runtime (opt-in): PubMed ranks only the backend's registered, verified
    sources against this patient's findings. Unregistered hits are never
    returned to the pipeline, so they cannot reach the model or the output.

Request URLs can contain NCBI_API_KEY, so errors never include URLs or bodies.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

import httpx

from ai.budget import check_deadline, request_timeout, retry_pause, run_request

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
MAX_RESULTS = 20          # per search or fetch request
MAX_TERM_CHARS = 1500     # PubMed handles longer terms, but bounded queries stay reviewable
DEFAULT_TIMEOUT = 10.0    # seconds per request
RATE_LIMIT_BACKOFF = 1.5  # seconds, once, after HTTP 429
_PMID = re.compile(r"^\d{1,9}$")

_lock = threading.Lock()
_last_request = 0.0


class PubMedError(RuntimeError):
    """A PubMed request failed or returned something unusable. Message is sanitized."""


@dataclass(frozen=True)
class AbstractSection:
    label: str | None
    text: str


@dataclass(frozen=True)
class PubMedRecord:
    pmid: str
    title: str
    journal: str
    year: int | None
    authors: list[str]
    doi: str | None
    pmcid: str | None
    publication_types: list[str]
    sections: list[AbstractSection] = field(default_factory=list)

    @property
    def url(self) -> str:
        return f"https://pubmed.ncbi.nlm.nih.gov/{self.pmid}/"

    @property
    def abstract(self) -> str:
        return "\n".join(f"{s.label}: {s.text}" if s.label else s.text for s in self.sections)

    def locate(self, excerpt: str) -> str | None:
        """Return 'Title' or 'Abstract[: LABEL]' if excerpt is verbatim there, else None."""
        needle = normalize(excerpt)
        if needle and needle in normalize(self.title):
            return "Title"
        for s in self.sections:
            if needle and needle in normalize(s.text):
                return f"Abstract: {s.label}" if s.label else "Abstract"
        return None


def normalize(text: str) -> str:
    """Whitespace-only normalization. Case and punctuation must match exactly."""
    return re.sub(r"\s+", " ", text).strip()


def _min_interval() -> float:
    # NCBI allows 3 requests/s without a key and 10/s with one.
    return 0.11 if os.getenv("NCBI_API_KEY", "").strip() else 0.34


def _get(endpoint: str, params: dict[str, str], timeout: float) -> bytes:
    global _last_request
    query = {"tool": "nextclue", **params}
    email = os.getenv("NCBI_EMAIL", "").strip()
    key = os.getenv("NCBI_API_KEY", "").strip()
    if email:
        query["email"] = email
    if key:
        query["api_key"] = key
    url = f"{EUTILS}/{endpoint}?{urllib.parse.urlencode(query)}"
    for attempt in (1, 2):
        check_deadline()
        with _lock:
            wait = _min_interval() - (time.monotonic() - _last_request)
            if wait > 0:
                retry_pause(wait)
            _last_request = time.monotonic()
        try:
            async def send():
                async with httpx.AsyncClient(timeout=request_timeout(timeout)) as client:
                    response = await client.get(
                        url, headers={"User-Agent": "NextClue/0.1 (synthetic-data prototype)"},
                    )
                    response.raise_for_status()
                    return response.content
            body = run_request(send, timeout)
            check_deadline()
            return body
        except httpx.HTTPStatusError as exc:
            check_deadline()
            status = exc.response.status_code
            if status == 429 and attempt == 1:
                retry_pause(RATE_LIMIT_BACKOFF)
                continue
            raise PubMedError(f"PubMed {endpoint} failed (HTTP {status}).") from None
        except (httpx.RequestError, TimeoutError, OSError) as exc:
            check_deadline()
            raise PubMedError(f"PubMed {endpoint} failed ({type(exc).__name__}).") from None
    raise PubMedError(f"PubMed {endpoint} failed.")


def search(term: str, *, retmax: int = 10, timeout: float = DEFAULT_TIMEOUT) -> list[str]:
    """Return up to `retmax` (max 20) real PMIDs for a PubMed query, relevance-sorted."""
    term = term.strip()
    if not term:
        raise ValueError("Empty PubMed query.")
    if len(term) > MAX_TERM_CHARS:
        raise ValueError(f"PubMed query longer than {MAX_TERM_CHARS} characters.")
    retmax = max(1, min(int(retmax), MAX_RESULTS))
    body = _get("esearch.fcgi", {
        "db": "pubmed", "term": term, "retmax": str(retmax), "sort": "relevance", "retmode": "json",
    }, timeout)
    try:
        ids = json.loads(body)["esearchresult"]["idlist"]
    except (ValueError, KeyError, TypeError):
        raise PubMedError("PubMed esearch returned an unexpected response.") from None
    return [i for i in ids if isinstance(i, str) and _PMID.match(i)][:retmax]


def fetch(pmids: list[str], *, timeout: float = DEFAULT_TIMEOUT) -> list[PubMedRecord]:
    """Fetch exact titles and abstracts for up to 20 PMIDs."""
    pmids = list(dict.fromkeys(p.strip() for p in pmids))
    if not pmids:
        return []
    if len(pmids) > MAX_RESULTS:
        raise ValueError(f"Fetch at most {MAX_RESULTS} PMIDs at a time.")
    if bad := [p for p in pmids if not _PMID.match(p)]:
        raise ValueError(f"Not PMIDs: {bad}")
    body = _get("efetch.fcgi", {"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"}, timeout)
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        raise PubMedError("PubMed efetch returned invalid XML.") from None
    records = [_parse_article(a) for a in root.iter("PubmedArticle")]
    records += [_parse_book(b) for b in root.iter("PubmedBookArticle")]
    order = {p: i for i, p in enumerate(pmids)}
    return sorted((r for r in records if r.pmid in order), key=lambda r: order[r.pmid])


def _text(el: ET.Element | None) -> str:
    return normalize("".join(el.itertext())) if el is not None else ""


def _year(*candidates: str | None) -> int | None:
    for value in candidates:
        if value and (m := re.search(r"\b(1[89]\d\d|20\d\d)\b", value)):
            return int(m.group(1))
    return None


def _sections(abstract: ET.Element | None) -> list[AbstractSection]:
    if abstract is None:
        return []
    return [
        AbstractSection(label=a.get("Label"), text=_text(a))
        for a in abstract.findall("AbstractText") if _text(a)
    ]


def _ids(el: ET.Element) -> dict[str, str]:
    return {i.get("IdType", ""): (i.text or "").strip() for i in el.iter("ArticleId")}


def _authors(el: ET.Element) -> list[str]:
    return [
        f"{a.findtext('LastName')} {a.findtext('Initials') or ''}".strip()
        for a in el.iter("Author") if a.findtext("LastName")
    ]


def _parse_article(article: ET.Element) -> PubMedRecord:
    citation = article.find("MedlineCitation")
    art = citation.find("Article") if citation is not None else None
    if citation is None or art is None:
        raise PubMedError("PubMed efetch returned an incomplete article.")
    issue_date = art.find("Journal/JournalIssue/PubDate")
    ids = _ids(article)
    return PubMedRecord(
        pmid=(citation.findtext("PMID") or "").strip(),
        title=_text(art.find("ArticleTitle")),
        journal=_text(art.find("Journal/Title")),
        year=_year(
            issue_date.findtext("Year") if issue_date is not None else None,
            issue_date.findtext("MedlineDate") if issue_date is not None else None,
        ),
        authors=_authors(art),
        doi=ids.get("doi"),
        pmcid=ids.get("pmc"),
        publication_types=[_text(t) for t in art.iter("PublicationType")],
        sections=_sections(art.find("Abstract")),
    )


def _parse_book(book: ET.Element) -> PubMedRecord:
    # GeneReviews chapters are indexed as book articles with their summary as abstract.
    doc = book.find("BookDocument")
    if doc is None:
        raise PubMedError("PubMed efetch returned an incomplete book record.")
    ids = _ids(doc)
    return PubMedRecord(
        pmid=(doc.findtext("PMID") or "").strip(),
        title=_text(doc.find("ArticleTitle")) or _text(doc.find("Book/BookTitle")),
        journal=_text(doc.find("Book/BookTitle")),
        year=_year(doc.findtext("Book/PubDate/Year")),
        authors=_authors(doc),
        doi=ids.get("doi"),
        pmcid=None,
        publication_types=[_text(t) for t in doc.iter("PublicationType")],
        sections=_sections(doc.find("Abstract")),
    )


# --------------------------------------------------------------------------
# Runtime: rank registered sources only
# --------------------------------------------------------------------------

_STOPWORDS = {
    "a", "an", "and", "at", "for", "from", "in", "of", "on", "or", "since", "the", "to", "with",
    "her", "his", "their", "she", "he", "patient", "reports", "reported", "history", "not", "no",
    "without", "both", "bilateral", "recurrent", "persistent", "possible", "after", "within",
    # Generic qualifiers that make PubMed groups fail without adding meaning.
    "type", "mild", "moderate", "severe", "elevated", "reduced", "increased", "decreased", "low",
    "high", "loss", "left", "right", "chronic", "acute", "disease", "syndrome", "finding",
    "range", "reference", "normal", "abnormal", "result", "activity", "level", "levels",
}


def finding_terms(labels: list[str], *, limit: int = 12) -> list[str]:
    """Turn finding labels into short PubMed groups. Labels are untrusted text.

    Only lowercase alphanumeric words survive, so labels cannot inject field
    tags or operators. A label becomes one word, or an OR of its word pairs:
    records indexed by title/MeSH only (no abstract) rarely contain every word.
    """
    groups: list[str] = []
    for label in labels:
        words = list(dict.fromkeys(
            w for w in re.findall(r"[a-z0-9]+", label.lower()) if w not in _STOPWORDS and len(w) > 2
        ))[:4]
        if not words:
            continue
        if len(words) == 1:
            group = f"({words[0]})"
        else:
            pairs = [f"({a} AND {b})" for i, a in enumerate(words) for b in words[i + 1:]]
            group = "(" + " OR ".join(pairs) + ")"
        if group not in groups:
            groups.append(group)
        if len(groups) >= limit:
            break
    return groups


def rank_registered(pmids: list[str], labels: list[str], *, timeout: float = DEFAULT_TIMEOUT) -> list[str]:
    """Ask PubMed which registered PMIDs match any of these findings.

    The query is restricted to the supplied PMIDs with [uid], so PubMed can
    only return sources that are already registered and evidence-versioned.
    """
    registered = [p for p in dict.fromkeys(pmids) if _PMID.match(p)][:MAX_RESULTS]
    groups = finding_terms(labels)
    if not registered or not groups:
        return []
    uids = "(" + " OR ".join(f"{p}[uid]" for p in registered) + ")"

    def build(g: list[str]) -> str:
        return f"{uids} AND ({' OR '.join(g)})"

    while groups and len(build(groups)) > MAX_TERM_CHARS:
        groups.pop()
    if not groups:
        return []
    hits = search(build(groups), retmax=len(registered), timeout=timeout)
    return [p for p in hits if p in registered]
