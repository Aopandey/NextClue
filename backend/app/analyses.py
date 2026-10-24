"""Analysis orchestration: cache lookup, pipeline execution, validation, fallback.

Reliability rules (team/daniel.md):
  * Cache identity = patient input + exclusions + schema/model/prompt/evidence versions.
  * If inference fails, replay a previously validated run of the same patient input,
    clearly labeled. If none exists, fail honestly. Fixtures are never replayed.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout

from pydantic import ValidationError

from . import db
from .config import get_settings
from .contracts import (
    ANALYSIS_SCHEMA_VERSION,
    AnalysisOutput,
    AnalysisRequest,
    AnalysisRun,
    PatientRecord,
    RunError,
    RunVersions,
)
from .pipeline import PipelineNotConnected, RetrievalFailed, run_pipeline
from .validation import AnalysisReferenceError, compute_cache_key, compute_input_key, validate_analysis
from .views import build_graph, build_timeline

log = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="pipeline")


class PatientNotFound(LookupError):
    pass


class InvalidRequest(ValueError):
    pass


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _without_excluded(patient: PatientRecord, excluded: list[str]) -> PatientRecord:
    return patient.model_copy(
        update={"documents": [d for d in patient.documents if d.record_id not in excluded]}
    )


def start_analysis(req: AnalysisRequest) -> tuple[AnalysisRun, bool]:
    """Return (run, needs_execution). A reused run needs no execution."""
    patient = db.get_patient(req.patient_id, req.record_version)
    if patient is None:
        raise PatientNotFound(req.patient_id)

    known = {d.record_id for d in patient.documents}
    unknown = sorted(set(req.excluded_record_ids) - known)
    if unknown:
        raise InvalidRequest(f"excluded_record_ids not in this record version: {unknown}")
    if len(set(req.excluded_record_ids)) == len(known):
        raise InvalidRequest("cannot exclude every document")
    excluded = sorted(set(req.excluded_record_ids))

    settings = get_settings()
    registry = db.get_source_registry()
    versions = RunVersions(
        schema_version=ANALYSIS_SCHEMA_VERSION,
        model=settings.model,
        prompt=settings.prompt_version,
        evidence=registry.evidence_version,
    )
    cache_key = compute_cache_key(
        patient, excluded,
        schema_version=versions.schema_version,
        model=versions.model,
        prompt_version=versions.prompt,
        evidence_version=versions.evidence,
    )

    if not req.force_refresh:
        existing = db.find_reusable_run(cache_key)
        if existing is not None:
            return existing, False

    run = AnalysisRun(
        run_id=f"run-{uuid.uuid4().hex[:16]}",
        status="queued",
        provenance="live",
        evidence_mode="cached",
        patient_id=patient.patient_id,
        record_version=patient.record_version,
        excluded_record_ids=excluded,
        cache_key=cache_key,
        versions=versions,
        created_at=_now(),
    )
    db.insert_run(run, compute_input_key(patient, excluded))
    return run, True


def execute_run(run_id: str) -> None:
    """Background task. Never raises: every outcome is written to the run row."""
    run = db.get_run(run_id)
    if run is None:
        log.error("run %s vanished before execution", run_id)
        return

    try:
        patient = db.get_patient(run.patient_id, run.record_version)
        registry = db.get_source_registry()
        run.status = "running"
        db.save_run(run)

        timeout = get_settings().analysis_timeout_seconds
        future = _executor.submit(
            run_pipeline, _without_excluded(patient, run.excluded_record_ids), registry.sources
        )
        result = future.result(timeout=timeout)

        output = (
            result.output if isinstance(result.output, AnalysisOutput)
            else AnalysisOutput.model_validate(result.output)
        )
        validate_analysis(output, patient, registry.sources, run.excluded_record_ids)

        run.status = "completed"
        run.evidence_mode = result.evidence_mode
        run.output = output
        run.timeline = build_timeline(output, patient, run.excluded_record_ids)
        run.graph = build_graph(output)
        run.completed_at = _now()
        db.save_run(run)
    except Exception as exc:  # noqa: BLE001 - every failure becomes a labeled run state
        log.exception("analysis %s failed", run_id)
        _fail_or_replay(run, _classify(exc))


def _classify(exc: Exception) -> RunError:
    if isinstance(exc, FuturesTimeout):
        return RunError(code="timeout", message="The AI pipeline did not finish in time.", retryable=True)
    if isinstance(exc, RetrievalFailed):
        return RunError(code="retrieval_failed", message=str(exc), retryable=True)
    if isinstance(exc, AnalysisReferenceError):
        return RunError(code="validation_failed", message="; ".join(exc.errors[:5]), retryable=True)
    if isinstance(exc, ValidationError):
        return RunError(
            code="validation_failed", message=f"Output did not match the schema: {exc.error_count()} errors",
            retryable=True,
        )
    if isinstance(exc, PipelineNotConnected):
        return RunError(code="model_error", message=str(exc), retryable=False)
    return RunError(code="model_error", message=f"{type(exc).__name__}: {exc}", retryable=True)


def _fail_or_replay(run: AnalysisRun, error: RunError) -> None:
    run.error = error
    run.completed_at = _now()

    patient = db.get_patient(run.patient_id, run.record_version)
    fallback = (
        db.find_fallback_run(compute_input_key(patient, run.excluded_record_ids), run.run_id)
        if patient is not None else None
    )
    if fallback is None:
        run.status = "failed"
    else:
        run.status = "completed"
        run.provenance = "replayed"
        run.replayed_from_run_id = fallback.run_id
        run.fallback_reason = (
            f"Live analysis failed ({error.code}). Showing a previously validated run "
            f"from {fallback.created_at:%Y-%m-%d %H:%M} UTC for the same patient record."
        )
        # Versions and evidence mode describe the replayed output, not the failed attempt.
        run.versions = fallback.versions
        run.evidence_mode = fallback.evidence_mode
        run.output = fallback.output
        run.timeline = fallback.timeline
        run.graph = fallback.graph
    db.save_run(run)
