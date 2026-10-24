"""Connection point for the AI pipeline (Avinash).

`run_pipeline` delegates to ai.pipeline. The backend handles everything around it:
caching, timeouts, schema + reference validation, persistence, and fallback.

Contract:
  * input:  the PatientRecord (excluded documents already removed) and the
            registered sources the model may cite.
  * output: PipelineResult whose `output` is an AnalysisOutput or a plain dict
            (e.g. parsed LLM JSON). The backend validates it, so returning the
            raw dict is fine and keeps validation errors in one place.
  * raise any exception on failure; the backend records it and falls back.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .contracts import AnalysisOutput, PatientRecord, Source


class PipelineNotConnected(RuntimeError):
    pass


class RetrievalFailed(RuntimeError):
    pass


@dataclass
class PipelineResult:
    output: AnalysisOutput | dict
    evidence_mode: Literal["live", "cached"]  # "cached" when live retrieval was unavailable


def run_pipeline(patient: PatientRecord, sources: list[Source]) -> PipelineResult:
    from ai.pipeline import EvidenceUnavailable, run_analysis

    try:
        output, selection = run_analysis(patient, sources)
    except EvidenceUnavailable as exc:
        raise RetrievalFailed(str(exc)) from None
    # Evidence always comes from the registered, evidence-versioned `sources`.
    # "live" only when a PubMed request ran for this run and chose among them
    # (EVIDENCE_RETRIEVAL=pubmed); otherwise, or if PubMed failed, "cached".
    return PipelineResult(output=output, evidence_mode=selection.mode)
