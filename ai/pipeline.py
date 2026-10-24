"""Two Gemini stages using Daniel's canonical types; no database access here.

Import through app.pipeline, or use `python -m ai.run` from the repo root.
The small stage envelopes are internal, not new public API contracts.
"""

from __future__ import annotations

import logging
import re

from pydantic import Field, ValidationError

from app.contracts import (
    AnalysisOutput, Claim, ClinicianQuestion, Contract, Finding, Hypothesis,
    MissingEvidence, PatientRecord, PriorResultReview, Source,
)
from app.validation import AnalysisReferenceError, find_reference_errors

from ai.gemini_client import generate_json, load_prompt
from ai.retrieval import EvidenceSelection, reviewed_sources, select_evidence


log = logging.getLogger(__name__)


class EvidenceUnavailable(RuntimeError):
    """The source registry has no reviewed evidence suitable for synthesis."""


# The handoff may be retried once with the validator's errors. Extraction is not
# retried: its quotes gate everything after it.
HANDOFF_ATTEMPTS = 2


class _Extraction(Contract):
    findings: list[Finding] = Field(min_length=1, max_length=12)


class _Handoff(Contract):
    claims: list[Claim]
    prior_results: list[PriorResultReview]
    hypotheses: list[Hypothesis] = Field(min_length=1, max_length=3)
    missing_evidence: list[MissingEvidence]
    clinician_questions: list[ClinicianQuestion]


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _check_findings(findings: list[Finding], patient: PatientRecord) -> None:
    documents = {d.record_id: d for d in patient.documents}
    seen: set[str] = set()
    errors: list[str] = []
    for finding in findings:
        if finding.finding_id in seen:
            errors.append(f"duplicate finding id {finding.finding_id!r}")
        seen.add(finding.finding_id)
        for ref in finding.record_refs:
            document = documents.get(ref.record_id)
            if document is None:
                errors.append(f"{finding.finding_id}: unknown or excluded record {ref.record_id!r}")
            elif not ref.excerpt.strip() or _normalize(ref.excerpt) not in _normalize(document.text):
                errors.append(f"{finding.finding_id}: excerpt not verbatim in {ref.record_id}")
    if errors:
        raise AnalysisReferenceError(errors)


def _model_view(patient: PatientRecord) -> dict:
    """Patient payload for the model. Internal only; the public schema is unchanged.

    Quotes are validated against each document's `text`. Real runs quoted
    structured observations (e.g. "Interventricular septum thickness 12 mm"),
    which never appear in `text`, so they are passed under an explicit
    non-quotable key while remaining available as context.
    """
    data = patient.model_dump(mode="json")
    for doc in data["documents"]:
        doc["observations_not_quotable"] = doc.pop("observations")
    return data


def _evidence_view(sources: list[Source]) -> list[dict]:
    """Evidence payload for the model; internal only.

    Each excerpt carries its exact citation pair. A real run cited an
    excerpt-like name ("src-fabry-phenocopy") as a source_id; repeating the
    source_id beside every excerpt removes that guesswork. URLs are omitted:
    the backend owns links, and the model must never emit them.
    """
    return [
        {
            "source_id": s.source_id,
            "title": s.title,
            "publisher": s.publisher,
            "year": s.year,
            "excerpts": [
                {
                    "cite_as": {"source_id": s.source_id, "excerpt_id": e.excerpt_id},
                    "text": e.text,
                    "location": e.location,
                }
                for e in s.excerpts
            ],
        }
        for s in sources
    ]


def extract_findings(patient: PatientRecord) -> list[Finding]:
    """One real call; verify extracted quotes before using them in reasoning."""
    stage = _Extraction.model_validate(generate_json(
        system_prompt=load_prompt("extract"),
        payload={"patient": _model_view(patient)},
        response_schema=_Extraction.model_json_schema(),
    ))
    _check_findings(stage.findings, patient)
    return stage.findings


def run_analysis(patient: PatientRecord, sources: list[Source]) -> tuple[AnalysisOutput, EvidenceSelection]:
    """Generate a fresh analysis and report which registered evidence it used.

    `sources` is the backend's registered, evidence-versioned registry. Only
    verified entries are eligible; selection (cached or PubMed-ranked) happens
    after extraction and never adds anything outside that list. Citations are
    validated against exactly the sources the model was shown. The backend owns
    run metadata, timeline/graph, persistence, and replay.
    """
    reviewed = reviewed_sources(sources)
    if not reviewed:
        raise EvidenceUnavailable(
            "No verified sources in the registry. Review backend/data/sources.json, "
            "replace placeholders, bump evidence_version, and re-seed before analysis."
        )
    findings = extract_findings(patient)
    selection = select_evidence(findings, reviewed)
    payload = {
        "patient": _model_view(patient),
        "findings": [f.model_dump(mode="json") for f in findings],
        "sources": _evidence_view(selection.sources),
    }
    errors: list[str] = []
    for _attempt in range(HANDOFF_ATTEMPTS):
        if errors:
            # One bounded evidence-review step: the same model sees why its
            # previous answer was rejected. The result is validated again.
            payload["validation_errors_from_previous_attempt"] = errors[:20]
        raw = generate_json(
            system_prompt=load_prompt("handoff"),
            payload=payload,
            response_schema=_Handoff.model_json_schema(),
        )
        try:
            output = AnalysisOutput.model_validate({
                "findings": [f.model_dump(mode="json") for f in findings],
                **_Handoff.model_validate(raw).model_dump(mode="json"),
            })
            check_output(output, patient, selection.sources)
            return output, selection
        except AnalysisReferenceError as exc:
            errors, last = exc.errors, exc
        except ValidationError as exc:
            # Locations and messages only; never echo input values into logs.
            errors = [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()]
            last = exc
        log.warning("handoff attempt %d rejected (%d errors): %s", _attempt + 1, len(errors), errors[:3])
    raise last


def check_output(output: AnalysisOutput, patient: PatientRecord, sources: list[Source]) -> None:
    """Daniel's validator plus the AI-side reasoning rules below."""
    errors = find_reference_errors(output, patient, sources)
    refs = [r for c in output.claims for r in c.record_refs]
    refs += [r for p in output.prior_results for r in p.record_refs]
    refs += [r for m in output.missing_evidence for r in m.existing_record_refs]
    if any(not r.excerpt.strip() for r in refs):
        errors.append("Record excerpts must not be blank.")
    errors += _limitation_errors(output) + _shared_support_errors(output) + _existing_first_errors(output)
    errors += _outcome_wording_errors(output)
    errors += [
        f"{h.hypothesis_id}: link at least one supporting or contradicting claim, or omit this explanation"
        for h in output.hypotheses if not (h.supporting_claim_ids or h.contradicting_claim_ids)
    ]
    if errors:
        raise AnalysisReferenceError(errors)


def _existing_first_errors(output: AnalysisOutput) -> list[str]:
    """Checking for existing records comes before seeking new information."""
    existing = [m for m in output.missing_evidence if m.check_existing_first]
    new = [m for m in output.missing_evidence if not m.check_existing_first]
    errors = [
        f"{m.missing_id}: check_existing_first needs existing_record_refs showing why it may exist"
        for m in existing if not m.existing_record_refs
    ]
    if existing and new and max(m.priority for m in existing) >= min(m.priority for m in new):
        errors.append(
            "missing_evidence: items with check_existing_first=true must have lower priority "
            "numbers than items about newly obtained information"
        )
    return errors


def _limitation_errors(output: AnalysisOutput) -> list[str]:
    """A prior test's limitation must be argued from that test's own records.

    IDs can all resolve while the limitation points at an unrelated claim (for
    example, a symptom claim). Require at least one limitation claim to cite a
    record that the prior-result review itself cites.
    """
    claims = {c.claim_id: c for c in output.claims}
    errors: list[str] = []
    for p in output.prior_results:
        test_records = {r.record_id for r in p.record_refs}
        cited = {r.record_id for cid in p.limitation_claim_ids if cid in claims for r in claims[cid].record_refs}
        if not test_records & cited:
            errors.append(
                f"{p.prior_result_id}: limitation claims {p.limitation_claim_ids} do not cite "
                f"the test's own records {sorted(test_records)}"
            )
    return errors


def _shared_support_errors(output: AnalysisOutput) -> list[str]:
    """Competing explanations cannot rest on the same evidence-backed claim.

    Findings may support several hypotheses; claims carry a medical
    interpretation from a cited source, so each supports at most one. Seen in
    real runs: the common alternative "supported" only by claims citing
    rare-disease evidence.
    """
    owner: dict[str, str] = {}
    errors: list[str] = []
    for h in output.hypotheses:
        for cid in h.supporting_claim_ids:
            if cid in owner and owner[cid] != h.hypothesis_id:
                errors.append(
                    f"{cid} supports both {owner[cid]} and {h.hypothesis_id}; cite evidence "
                    "specific to each explanation or leave the claim with one of them"
                )
            owner.setdefault(cid, h.hypothesis_id)
    return errors


_OVERCONFIDENT = re.compile(
    r"\b(?:would|will|can|could)\s+(?:definitively\s+|conclusively\s+)?(?:establish|confirm|prove|diagnose|rule\s+out|exclude)\b"
    r"|\b(?:confirms?|confirmed|proves?|proven|definitive(?:ly)?|conclusive(?:ly)?|diagnostic\s+of)\b",
    re.IGNORECASE,
)


def _outcome_wording_errors(output: AnalysisOutput) -> list[str]:
    """Possible outcomes may not claim to settle a diagnosis; the clinician does that."""
    errors: list[str] = []
    for m in output.missing_evidence:
        for o in m.possible_outcomes:
            hit = _OVERCONFIDENT.search(f"{o.outcome} {o.implication}")
            if hit:
                errors.append(
                    f"{m.missing_id}: possible_outcomes says \"{hit.group(0)}\"; "
                    "use \"would support\", \"would make ... less likely\" or \"would remain inconclusive\""
                )
    return errors


def analyze_patient(patient: PatientRecord, sources: list[Source]) -> AnalysisOutput:
    """Output only; use run_analysis when the evidence label is needed."""
    return run_analysis(patient, sources)[0]
