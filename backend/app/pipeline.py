"""Connection point for the AI pipeline (Avinash).

Replace the body of `run_pipeline`. The backend handles everything around it:
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
    raise PipelineNotConnected("The AI pipeline is not connected yet (backend/app/pipeline.py).")
