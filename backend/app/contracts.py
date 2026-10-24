"""Shared JSON contracts for NextClue (see contracts/README.md).

These Pydantic models are the single source of truth. Regenerate the JSON Schema
files with `python -m scripts.export_schemas` (from backend/) after any change,
and bump the schema version string if the change is not backwards compatible.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PATIENT_SCHEMA_VERSION = "patient.v1"
ANALYSIS_SCHEMA_VERSION = "analysis.v1"
SOURCE_SCHEMA_VERSION = "source.v1"

DISCLAIMER = (
    "Clinical decision support prototype using synthetic data. Not clinically "
    "validated."
)

# Typed ID prefixes let the validator catch a reference to the wrong kind of object.
RECORD_ID = r"^rec-[a-z0-9-]+$"
FINDING_ID = r"^fnd-[a-z0-9-]+$"
CLAIM_ID = r"^clm-[a-z0-9-]+$"
HYPOTHESIS_ID = r"^hyp-[a-z0-9-]+$"
PRIOR_RESULT_ID = r"^pri-[a-z0-9-]+$"
MISSING_ID = r"^mis-[a-z0-9-]+$"
QUESTION_ID = r"^q-[a-z0-9-]+$"
SOURCE_ID = r"^src-[a-z0-9-]+$"
EXCERPT_ID = r"^exc-[a-z0-9-]+$"


class Contract(BaseModel):
    # Reject unknown keys so LLM drift fails validation instead of passing silently.
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------
# 1. Patient input
# --------------------------------------------------------------------------


class Observation(Contract):
    name: str
    value: str
    unit: str | None = None
    reference_range: str | None = None
    interpretation: Literal["normal", "abnormal", "borderline", "not_interpreted"]


class PatientDocument(Contract):
    record_id: str = Field(pattern=RECORD_ID)
    date: dt.date
    type: Literal[
        "clinic_note", "lab_result", "imaging", "pathology", "referral", "genetic_report", "other"
    ]
    specialty: str
    title: str
    author_role: str | None = Field(default=None, description="Role only, never a name")
    text: str
    observations: list[Observation] = []


class Demographics(Contract):
    display_name: str
    sex_at_birth: Literal["female", "male", "intersex", "unknown"]
    birth_year: int


class PatientRecord(Contract):
    schema_version: Literal["patient.v1"] = PATIENT_SCHEMA_VERSION
    patient_id: str
    record_version: int = Field(ge=1, description="Bump whenever any document changes")
    synthetic: Literal[True] = True
    demographics: Demographics
    documents: list[PatientDocument] = Field(min_length=1)


# --------------------------------------------------------------------------
# 2. Analysis request
# --------------------------------------------------------------------------


class AnalysisRequest(Contract):
    patient_id: str
    record_version: int | None = Field(default=None, description="Omit for latest")
    excluded_record_ids: list[str] = []
    force_refresh: bool = False


# --------------------------------------------------------------------------
# 3. Analysis output (produced by the AI pipeline)
# --------------------------------------------------------------------------


class RecordRef(Contract):
    record_id: str = Field(pattern=RECORD_ID)
    excerpt: str = Field(description="Exact quote from the document text")


class SourceRef(Contract):
    source_id: str = Field(pattern=SOURCE_ID)
    excerpt_id: str = Field(pattern=EXCERPT_ID)


class Finding(Contract):
    finding_id: str = Field(pattern=FINDING_ID)
    label: str
    kind: Literal[
        "symptom", "sign", "lab_result", "imaging", "pathology", "diagnosis", "family_history"
    ]
    assertion: Literal["present", "absent", "uncertain"]
    date: dt.date | None = None
    specialty: str | None = None
    record_refs: list[RecordRef] = Field(min_length=1)
    hpo_id: str | None = Field(default=None, pattern=r"^HP:\d{7}$")


class Claim(Contract):
    claim_id: str = Field(pattern=CLAIM_ID)
    text: str
    record_refs: list[RecordRef] = Field(min_length=1)
    source_refs: list[SourceRef] = Field(min_length=1)


class PriorResultReview(Contract):
    prior_result_id: str = Field(pattern=PRIOR_RESULT_ID)
    test_name: str
    record_refs: list[RecordRef] = Field(min_length=1)
    result_summary: str
    interpretation_at_the_time: str
    what_it_established: str
    limitation_claim_ids: list[str] = Field(min_length=1)
    hypothesis_ids: list[str] = []


class Hypothesis(Contract):
    hypothesis_id: str = Field(pattern=HYPOTHESIS_ID)
    name: str
    is_rare_disease: bool
    status: Literal["open", "less_supported", "excluded"]
    summary: str
    supporting_finding_ids: list[str] = []
    supporting_claim_ids: list[str] = []
    contradicting_claim_ids: list[str] = []


class PossibleOutcome(Contract):
    outcome: str
    implication: str


class MissingEvidence(Contract):
    missing_id: str = Field(pattern=MISSING_ID)
    priority: int = Field(ge=1, description="1 = investigate first")
    description: str
    why_it_matters: str
    check_existing_first: bool
    existing_record_refs: list[RecordRef] = []
    claim_ids: list[str] = Field(min_length=1)
    hypothesis_ids: list[str] = []
    possible_outcomes: list[PossibleOutcome] = []


class ClinicianQuestion(Contract):
    question_id: str = Field(pattern=QUESTION_ID)
    text: str
    missing_ids: list[str] = []


class AnalysisOutput(Contract):
    findings: list[Finding]
    claims: list[Claim]
    prior_results: list[PriorResultReview]
    hypotheses: list[Hypothesis] = Field(min_length=1, max_length=3)
    missing_evidence: list[MissingEvidence]
    clinician_questions: list[ClinicianQuestion]


# --------------------------------------------------------------------------
# 4. Analysis run envelope (what the frontend receives)
# --------------------------------------------------------------------------


class TimelineEvent(Contract):
    record_id: str
    date: dt.date
    specialty: str
    title: str
    finding_ids: list[str]


class GraphNode(Contract):
    node_id: str
    type: Literal["finding", "hypothesis", "prior_result", "missing_evidence"]
    label: str


class GraphEdge(Contract):
    edge_id: str
    source: str
    target: str
    relation: Literal["supports", "previously_tested", "would_clarify"]


class ClueGraph(Contract):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class RunVersions(Contract):
    schema_version: str
    model: str
    prompt: str
    evidence: str


class RunError(Contract):
    code: Literal[
        "timeout", "model_error", "validation_failed", "retrieval_failed", "not_found", "internal"
    ]
    message: str
    retryable: bool


class AnalysisRun(Contract):
    schema_version: Literal["analysis.v1"] = ANALYSIS_SCHEMA_VERSION
    run_id: str
    status: Literal["queued", "running", "completed", "failed"]
    provenance: Literal["live", "replayed", "fixture"]
    replayed_from_run_id: str | None = None
    fallback_reason: str | None = None
    evidence_mode: Literal["live", "cached"]
    patient_id: str
    record_version: int
    excluded_record_ids: list[str] = []
    cache_key: str
    versions: RunVersions
    created_at: dt.datetime
    completed_at: dt.datetime | None = None
    error: RunError | None = None
    output: AnalysisOutput | None = None
    timeline: list[TimelineEvent] | None = None
    graph: ClueGraph | None = None
    disclaimer: str = DISCLAIMER


# --------------------------------------------------------------------------
# 5. Medical evidence
# --------------------------------------------------------------------------


class SourceExcerpt(Contract):
    excerpt_id: str = Field(pattern=EXCERPT_ID)
    text: str
    location: str | None = None


class Source(Contract):
    source_id: str = Field(pattern=SOURCE_ID)
    source_type: Literal["genereviews", "pubmed", "guideline", "hpo", "other"]
    title: str
    publisher: str
    year: int | None = None
    url: str = Field(pattern=r"^https://")
    pmid: str | None = None
    excerpts: list[SourceExcerpt] = Field(min_length=1)
    verification_status: Literal["verified", "unverified"]
    retrieved_on: dt.date | None = None


class SourceRegistry(Contract):
    schema_version: Literal["source.v1"] = SOURCE_SCHEMA_VERSION
    evidence_version: str
    sources: list[Source]
