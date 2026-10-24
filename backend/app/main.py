"""NextClue API. Run from backend/: `uvicorn app.main:app --reload`."""

from __future__ import annotations

import datetime as dt
import logging

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ai.configuration import ConfigurationError

from . import db
from .analyses import InvalidRequest, PatientNotFound, execute_run, start_analysis
from .config import get_cors_origins, get_settings
from .contracts import ANALYSIS_SCHEMA_VERSION, AnalysisRequest, AnalysisRun, PatientRecord, RunVersions, Source
from .data_files import load_fixture_output
from .validation import compute_cache_key, find_reference_errors
from .views import build_graph, build_timeline

log = logging.getLogger(__name__)

app = FastAPI(title="NextClue API", version="0.1.0")


# Registered before CORSMiddleware so it sits inside it; an Exception handler would run
# in ServerErrorMiddleware, outside CORS, and the browser would see a CORS failure.
@app.middleware("http")
async def internal_error_with_cors(request: Request, call_next):
    try:
        return await call_next(request)
    except Exception:  # noqa: BLE001
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": {
            "code": "internal", "message": "Unexpected server error.", "retryable": True,
        }})


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(ConfigurationError)
async def configuration_error(request: Request, exc: ConfigurationError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": {
        "code": "configuration_error", "message": str(exc), "retryable": False,
    }})


@app.get("/health")
def health(response: Response) -> dict:
    settings = get_settings()
    try:
        db.ping()
    except Exception as exc:  # noqa: BLE001
        response.status_code = 503
        return {"status": "degraded", "database": f"unreachable: {type(exc).__name__}"}
    return {"status": "ok", "database": "ok", "model": settings.model}


@app.get("/patients")
def list_patients() -> list[dict]:
    return db.list_patients()


@app.get("/patients/{patient_id}", response_model=PatientRecord)
def get_patient(patient_id: str, record_version: int | None = None) -> PatientRecord:
    patient = db.get_patient(patient_id, record_version)
    if patient is None:
        raise HTTPException(404, f"patient {patient_id!r} not found")
    return patient


@app.post("/analyses", response_model=AnalysisRun)
def create_analysis(req: AnalysisRequest, background: BackgroundTasks, response: Response) -> AnalysisRun:
    try:
        run, needs_execution = start_analysis(req)
    except PatientNotFound:
        raise HTTPException(404, f"patient {req.patient_id!r} not found")
    except InvalidRequest as exc:
        raise HTTPException(422, str(exc))
    if needs_execution:
        background.add_task(execute_run, run.run_id)
        response.status_code = 202
    return run


@app.get("/analyses/{run_id}", response_model=AnalysisRun)
def get_analysis(run_id: str) -> AnalysisRun:
    run = db.get_run(run_id)
    if run is None:
        raise HTTPException(404, f"analysis run {run_id!r} not found")
    return run


@app.get("/sources/{source_id}", response_model=Source)
def get_source(source_id: str) -> Source:
    source = db.get_source(source_id)
    if source is None:
        raise HTTPException(404, f"source {source_id!r} not found")
    return source


@app.get("/fixtures/analyses/{patient_id}", response_model=AnalysisRun)
def get_fixture_analysis(patient_id: str) -> AnalysisRun:
    """Hand-authored sample for UI development. Labeled provenance='fixture'; never an AI run."""
    output = load_fixture_output(patient_id)
    patient = db.get_patient(patient_id)
    if output is None or patient is None:
        raise HTTPException(404, f"no fixture for patient {patient_id!r}")
    registry = db.get_source_registry()
    errors = find_reference_errors(output, patient, registry.sources)
    if errors:
        raise HTTPException(500, {"message": "fixture is out of date with the stored data", "errors": errors})

    versions = RunVersions(
        schema_version=ANALYSIS_SCHEMA_VERSION,
        model="hand-authored-fixture",
        prompt="none",
        evidence=registry.evidence_version,
    )
    return AnalysisRun(
        run_id=f"fixture-{patient_id}",
        status="completed",
        provenance="fixture",
        evidence_mode="cached",
        patient_id=patient_id,
        record_version=patient.record_version,
        cache_key=compute_cache_key(
            patient, [], schema_version=versions.schema_version, model=versions.model,
            prompt_version=versions.prompt, evidence_version=versions.evidence,
        ),
        versions=versions,
        created_at=dt.datetime(2026, 10, 24, tzinfo=dt.timezone.utc),
        completed_at=dt.datetime(2026, 10, 24, tzinfo=dt.timezone.utc),
        output=output,
        timeline=build_timeline(output, patient),
        graph=build_graph(output),
    )
