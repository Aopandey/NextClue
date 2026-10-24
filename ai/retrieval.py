"""Evidence selection for one analysis run.

The backend supplies the registered, evidence-versioned sources. This module
decides which of those the model sees and labels how that was decided:

  * cached (default): every verified registered source; no network.
  * live (EVIDENCE_RETRIEVAL=pubmed): a bounded PubMed query, restricted to the
    registered PMIDs, ranks which registered sources match this patient's
    extracted findings. A hit outside the registry is impossible by query
    construction and is also filtered here. If PubMed fails or matches nothing,
    the run falls back to the full cache and is labeled cached.

"live" therefore means a PubMed request ran for this analysis and determined
the evidence set. It never means unregistered search results were used.
"""

from __future__ import annotations

import os
import math
import re
from dataclasses import dataclass
from typing import Literal

from app.contracts import Finding, Source

from ai import pubmed
from ai.gemini_client import load_env_files
from ai.configuration import ConfigurationError

Mode = Literal["live", "cached"]
PLACEHOLDER = re.compile(r"\[unverified|placeholder|to be selected|todo", re.IGNORECASE)


def reviewed_sources(sources: list[Source]) -> list[Source]:
    """Verified sources only, and never one that still carries placeholder text."""
    return [
        s for s in sources
        if s.verification_status == "verified"
        and not PLACEHOLDER.search(s.title)
        and not any(PLACEHOLDER.search(e.text) for e in s.excerpts)
    ]


@dataclass(frozen=True)
class EvidenceSelection:
    sources: list[Source]
    mode: Mode
    note: str


def retrieval_setting() -> str:
    load_env_files()
    value = os.getenv("EVIDENCE_RETRIEVAL", "cached").strip().lower() or "cached"
    if value not in {"cached", "pubmed"}:
        raise ConfigurationError("EVIDENCE_RETRIEVAL must be 'cached' or 'pubmed'.")
    return value


def pubmed_timeout() -> float:
    try:
        value = float(os.getenv("PUBMED_TIMEOUT_SECONDS", str(pubmed.DEFAULT_TIMEOUT)))
    except ValueError:
        raise ConfigurationError("PUBMED_TIMEOUT_SECONDS must be a finite positive number.") from None
    if not math.isfinite(value) or value <= 0:
        raise ConfigurationError("PUBMED_TIMEOUT_SECONDS must be a finite positive number.")
    return min(max(value, 1.0), 30.0)


def select_evidence(findings: list[Finding], reviewed: list[Source]) -> EvidenceSelection:
    """Choose evidence from already-verified registered sources only."""
    if retrieval_setting() == "cached":
        return EvidenceSelection(reviewed, "cached", "Registered evidence cache; live retrieval not enabled.")

    by_pmid = {s.pmid: s for s in reviewed if s.pmid}
    if not by_pmid:
        return EvidenceSelection(reviewed, "cached", "No registered source has a PMID; used the cache.")
    labels = [f.label for f in findings if f.kind != "family_history"]
    try:
        hits = pubmed.rank_registered(list(by_pmid), labels, timeout=pubmed_timeout())
    except pubmed.PubMedError as exc:
        return EvidenceSelection(reviewed, "cached", f"{exc} Used the registered cache.")
    selected = [by_pmid[p] for p in hits if p in by_pmid]
    if not selected:
        return EvidenceSelection(reviewed, "cached", "PubMed matched no registered source; used the cache.")
    # Registered sources without a PMID cannot be ranked by PubMed; keep them.
    unranked = [s for s in reviewed if not s.pmid]
    return EvidenceSelection(
        selected + unranked, "live",
        f"PubMed matched {len(selected)} of {len(by_pmid)} registered PubMed-indexed sources to these findings.",
    )
