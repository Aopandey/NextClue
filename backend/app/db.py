"""Supabase persistence. All table access goes through this module."""

from __future__ import annotations

from functools import lru_cache

from supabase import Client, create_client

from .config import get_settings
from .contracts import AnalysisRun, PatientRecord, Source, SourceRegistry

# Envelope fields that are constants of the contract rather than stored columns.
_RUN_COMPUTED_FIELDS = {"schema_version", "disclaimer"}


@lru_cache
def client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_key)


def ping() -> None:
    client().table("patients").select("patient_id").limit(1).execute()


# ---------------------------------------------------------------- patients


def list_patients() -> list[dict]:
    return (
        client().table("patients")
        .select("patient_id, display_name, sex_at_birth, birth_year, current_version")
        .order("patient_id")
        .execute().data
    )


def get_patient(patient_id: str, record_version: int | None = None) -> PatientRecord | None:
    rows = client().table("patients").select("*").eq("patient_id", patient_id).execute().data
    if not rows:
        return None
    patient = rows[0]
    version = record_version or patient["current_version"]
    docs = (
        client().table("patient_documents")
        .select("record_id, date, type, specialty, title, author_role, text, observations")
        .eq("patient_id", patient_id)
        .eq("record_version", version)
        .order("date")
        .order("record_id")
        .execute().data
    )
    if not docs:
        return None
    return PatientRecord(
        patient_id=patient_id,
        record_version=version,
        demographics={
            "display_name": patient["display_name"],
            "sex_at_birth": patient["sex_at_birth"],
            "birth_year": patient["birth_year"],
        },
        documents=docs,
    )


def upsert_patient(record: PatientRecord) -> None:
    db = client()
    db.table("patients").upsert({
        "patient_id": record.patient_id,
        "current_version": record.record_version,
        "synthetic": True,
        **record.demographics.model_dump(),
    }).execute()
    # Replace this version's documents wholesale so removed documents disappear too.
    (
        db.table("patient_documents").delete()
        .eq("patient_id", record.patient_id)
        .eq("record_version", record.record_version)
        .execute()
    )
    db.table("patient_documents").insert([
        {"patient_id": record.patient_id, "record_version": record.record_version, **d.model_dump(mode="json")}
        for d in record.documents
    ]).execute()


# ----------------------------------------------------------------- sources


def get_source_registry() -> SourceRegistry:
    rows = client().table("sources").select("*").order("source_id").execute().data
    versions = {r.pop("evidence_version") for r in rows}
    if len(versions) > 1:
        raise RuntimeError(f"sources table mixes evidence versions: {sorted(versions)}")
    return SourceRegistry(evidence_version=versions.pop() if versions else "empty", sources=rows)


def get_source(source_id: str) -> Source | None:
    rows = client().table("sources").select("*").eq("source_id", source_id).execute().data
    if not rows:
        return None
    rows[0].pop("evidence_version")
    return Source.model_validate(rows[0])


def replace_sources(registry: SourceRegistry) -> None:
    db = client()
    db.table("sources").delete().neq("source_id", "").execute()
    if registry.sources:
        db.table("sources").insert([
            {"evidence_version": registry.evidence_version, **s.model_dump(mode="json")}
            for s in registry.sources
        ]).execute()


# -------------------------------------------------------------------- runs


def _run_from_row(row: dict) -> AnalysisRun:
    row.pop("input_key", None)
    return AnalysisRun.model_validate(row)


def insert_run(run: AnalysisRun, input_key: str) -> None:
    if run.provenance == "fixture":
        raise ValueError("fixtures are never stored as analysis runs")
    row = run.model_dump(mode="json", exclude=_RUN_COMPUTED_FIELDS)
    client().table("analysis_runs").insert({**row, "input_key": input_key}).execute()


def save_run(run: AnalysisRun) -> None:
    row = run.model_dump(mode="json", exclude=_RUN_COMPUTED_FIELDS | {"run_id"})
    client().table("analysis_runs").update(row).eq("run_id", run.run_id).execute()


def get_run(run_id: str) -> AnalysisRun | None:
    rows = client().table("analysis_runs").select("*").eq("run_id", run_id).execute().data
    return _run_from_row(rows[0]) if rows else None


def find_reusable_run(cache_key: str) -> AnalysisRun | None:
    """A live run with identical inputs that is finished or still in progress."""
    rows = (
        client().table("analysis_runs").select("*")
        .eq("cache_key", cache_key)
        .eq("provenance", "live")
        .in_("status", ["queued", "running", "completed"])
        .order("created_at", desc=True)
        .limit(1)
        .execute().data
    )
    return _run_from_row(rows[0]) if rows else None


def find_fallback_run(input_key: str, exclude_run_id: str) -> AnalysisRun | None:
    """Most recent validated live run for the same patient input, any model/prompt version."""
    rows = (
        client().table("analysis_runs").select("*")
        .eq("input_key", input_key)
        .eq("provenance", "live")
        .eq("status", "completed")
        .neq("run_id", exclude_run_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute().data
    )
    return _run_from_row(rows[0]) if rows else None
