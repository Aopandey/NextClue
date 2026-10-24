"""Checks that schema validation alone cannot express.

Pydantic guarantees shape. This module guarantees that every ID in an analysis
resolves, that patient excerpts are real quotes, and that the analysis follows
the project's reasoning rules. Nothing reaches the frontend until it passes.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from collections.abc import Iterable

from .contracts import AnalysisOutput, PatientRecord, RecordRef, Source


class AnalysisReferenceError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("Analysis failed reference checks:\n  - " + "\n  - ".join(errors))


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def find_reference_errors(
    output: AnalysisOutput,
    patient: PatientRecord,
    sources: Iterable[Source],
    excluded_record_ids: Iterable[str] = (),
) -> list[str]:
    errors: list[str] = []
    excluded = set(excluded_record_ids)
    documents = {d.record_id: d for d in patient.documents if d.record_id not in excluded}
    excerpts = {s.source_id: {e.excerpt_id for e in s.excerpts} for s in sources}

    def unique(kind: str, ids: list[str]) -> set[str]:
        for dup, n in Counter(ids).items():
            if n > 1:
                errors.append(f"duplicate {kind} id {dup!r}")
        return set(ids)

    finding_ids = unique("finding", [f.finding_id for f in output.findings])
    claim_ids = unique("claim", [c.claim_id for c in output.claims])
    hypothesis_ids = unique("hypothesis", [h.hypothesis_id for h in output.hypotheses])
    missing_ids = unique("missing_evidence", [m.missing_id for m in output.missing_evidence])
    unique("prior_result", [p.prior_result_id for p in output.prior_results])
    unique("question", [q.question_id for q in output.clinician_questions])

    def check_records(where: str, refs: list[RecordRef]) -> None:
        for ref in refs:
            doc = documents.get(ref.record_id)
            if doc is None:
                errors.append(f"{where}: unknown or excluded record {ref.record_id!r}")
            elif _normalize(ref.excerpt) not in _normalize(doc.text):
                errors.append(f"{where}: excerpt not verbatim in {ref.record_id}: {ref.excerpt!r}")

    def check_ids(where: str, ids: list[str], valid: set[str], kind: str) -> None:
        for i in ids:
            if i not in valid:
                errors.append(f"{where}: unknown {kind} {i!r}")

    for f in output.findings:
        check_records(f.finding_id, f.record_refs)

    for c in output.claims:
        check_records(c.claim_id, c.record_refs)
        for ref in c.source_refs:
            if ref.source_id not in excerpts:
                errors.append(f"{c.claim_id}: unknown source {ref.source_id!r}")
            elif ref.excerpt_id not in excerpts[ref.source_id]:
                errors.append(f"{c.claim_id}: unknown excerpt {ref.excerpt_id!r} in {ref.source_id}")

    for p in output.prior_results:
        check_records(p.prior_result_id, p.record_refs)
        check_ids(p.prior_result_id, p.limitation_claim_ids, claim_ids, "claim")
        check_ids(p.prior_result_id, p.hypothesis_ids, hypothesis_ids, "hypothesis")

    for h in output.hypotheses:
        check_ids(h.hypothesis_id, h.supporting_finding_ids, finding_ids, "finding")
        check_ids(h.hypothesis_id, h.supporting_claim_ids + h.contradicting_claim_ids, claim_ids, "claim")

    for m in output.missing_evidence:
        check_records(m.missing_id, m.existing_record_refs)
        check_ids(m.missing_id, m.claim_ids, claim_ids, "claim")
        check_ids(m.missing_id, m.hypothesis_ids, hypothesis_ids, "hypothesis")

    for q in output.clinician_questions:
        check_ids(q.question_id, q.missing_ids, missing_ids, "missing_evidence")

    if not any(not h.is_rare_disease for h in output.hypotheses):
        errors.append("hypotheses must include at least one non-rare-disease alternative")

    return errors


def validate_analysis(
    output: AnalysisOutput,
    patient: PatientRecord,
    sources: Iterable[Source],
    excluded_record_ids: Iterable[str] = (),
) -> None:
    errors = find_reference_errors(output, patient, list(sources), excluded_record_ids)
    if errors:
        raise AnalysisReferenceError(errors)


def _hash(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()


def compute_input_key(patient: PatientRecord, excluded_record_ids: Iterable[str]) -> str:
    """Identity of the patient input alone, used to find a fallback run after a failure."""
    return _hash({
        "patient": patient.model_dump(mode="json"),
        "excluded_record_ids": sorted(excluded_record_ids),
    })


def compute_cache_key(
    patient: PatientRecord,
    excluded_record_ids: Iterable[str],
    *,
    schema_version: str,
    model: str,
    prompt_version: str,
    evidence_version: str,
) -> str:
    """Identity of an analysis; any changed input yields a new key.

    The full record is hashed, not just record_version, so an edited document
    invalidates old runs even if nobody remembered to bump the version.
    """
    return _hash({
        "patient": patient.model_dump(mode="json"),
        "excluded_record_ids": sorted(excluded_record_ids),
        "schema_version": schema_version,
        "model": model,
        "prompt_version": prompt_version,
        "evidence_version": evidence_version,
    })
