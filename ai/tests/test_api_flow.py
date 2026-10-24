"""Daniel's real API routes and run lifecycle, with an in-memory stand-in for app.db.

Covers POST /analyses -> background execute_run -> app.pipeline -> ai.pipeline ->
GET /analyses/{id} and GET /sources/{id}. Gemini and PubMed are mocked; Supabase
is replaced only at the app.db function boundary. Not a database test.
"""

from __future__ import annotations

from copy import deepcopy
from unittest.mock import patch

import pytest

from fastapi.testclient import TestClient  # noqa: E402

from app import db  # noqa: E402
from app.data_files import load_fixture_output, load_patient_files, load_source_registry  # noqa: E402
from app.main import app  # noqa: E402


class FakeDb:
    def __init__(self):
        self.patients = {p.patient_id: p for p in load_patient_files()}
        self.registry = load_source_registry()
        self.runs = {}

    def get_patient(self, patient_id, record_version=None):
        return self.patients.get(patient_id)

    def get_source_registry(self):
        return self.registry

    def get_source(self, source_id):
        return next((s for s in self.registry.sources if s.source_id == source_id), None)

    def find_reusable_run(self, cache_key):
        matches = [r for r in self.runs.values() if r.cache_key == cache_key
                   and r.provenance == "live" and r.status in {"queued", "running", "completed"}]
        return max(matches, key=lambda r: r.created_at).model_copy(deep=True) if matches else None

    def find_fallback_run(self, input_key, exclude_run_id):
        return None

    def insert_run(self, run, input_key):
        self.runs[run.run_id] = run.model_copy(deep=True)

    def save_run(self, run):
        self.runs[run.run_id] = run.model_copy(deep=True)

    def get_run(self, run_id):
        run = self.runs.get(run_id)
        return run.model_copy(deep=True) if run else None


@pytest.fixture
def api(monkeypatch):
    fake = FakeDb()
    for name in ("get_patient", "get_source_registry", "get_source", "find_reusable_run",
                 "find_fallback_run", "insert_run", "save_run", "get_run"):
        monkeypatch.setattr(db, name, getattr(fake, name))
    return TestClient(app), fake


def _stages():
    handoff = deepcopy(load_fixture_output("sarah-001").model_dump(mode="json"))
    return {"findings": handoff.pop("findings")}, handoff


@pytest.mark.parametrize("mode, ranked, expected", [
    ("cached", None, "cached"),
    ("pubmed", ["20301469", "29112785"], "live"),
])
def test_full_api_flow_records_evidence_mode(monkeypatch, api, mode, ranked, expected):
    client, fake = api
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", mode)
    extraction, handoff = _stages()
    with patch("ai.pipeline.generate_json", side_effect=[extraction, handoff]), \
         patch("ai.pubmed.rank_registered", return_value=ranked or []):
        created = client.post("/analyses", json={"patient_id": "sarah-001"})
    assert created.status_code == 202
    assert created.json()["evidence_mode"] == "cached"  # not live until retrieval has run

    run = client.get(f"/analyses/{created.json()['run_id']}").json()
    assert run["status"] == "completed", run["error"]
    assert run["provenance"] == "live"
    assert run["evidence_mode"] == expected
    assert run["versions"]["evidence"] == fake.registry.evidence_version
    assert run["timeline"] and run["graph"]["nodes"]

    for ref in {(r["source_id"]) for c in run["output"]["claims"] for r in c["source_refs"]}:
        source = client.get(f"/sources/{ref}")
        assert source.status_code == 200 and source.json()["verification_status"] == "verified"


def test_provider_failure_is_an_honest_failed_run(api):
    from ai.gemini_client import GeminiRequestError

    client, _ = api
    with patch("ai.pipeline.generate_json", side_effect=GeminiRequestError("Gemini request failed (HTTP 503).")):
        created = client.post("/analyses", json={"patient_id": "sarah-001"})
    run = client.get(f"/analyses/{created.json()['run_id']}").json()
    assert run["status"] == "failed" and run["output"] is None
    assert run["error"]["code"] == "model_error" and "HTTP 503" in run["error"]["message"]


def test_unreviewed_registry_fails_as_retrieval_failed(api):
    client, fake = api
    fake.registry = fake.registry.model_copy(update={"sources": [
        s.model_copy(update={"verification_status": "unverified"}) for s in fake.registry.sources
    ]})
    with patch("ai.pipeline.generate_json") as generate:
        created = client.post("/analyses", json={"patient_id": "sarah-001"})
    run = client.get(f"/analyses/{created.json()['run_id']}").json()
    generate.assert_not_called()
    assert run["status"] == "failed" and run["error"]["code"] == "retrieval_failed"


def test_retrieval_mode_change_does_not_reuse_cached_run(monkeypatch, api):
    client, _ = api
    extraction, handoff = _stages()
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "cached")
    with patch("ai.pipeline.generate_json", side_effect=[extraction, handoff]):
        first = client.post("/analyses", json={"patient_id": "sarah-001"})
    assert first.status_code == 202
    with patch("ai.pipeline.generate_json") as generate:
        reused = client.post("/analyses", json={"patient_id": "sarah-001"})
    assert reused.status_code == 200
    assert reused.json()["run_id"] == first.json()["run_id"]
    generate.assert_not_called()
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "pubmed")
    with patch("ai.pipeline.generate_json", side_effect=[extraction, handoff]), \
         patch("ai.pubmed.rank_registered", return_value=["20301469", "29112785"]):
        live = client.post("/analyses", json={"patient_id": "sarah-001"})
    assert live.status_code == 202
    assert live.json()["cache_key"] != first.json()["cache_key"]
    run = client.get(f"/analyses/{live.json()['run_id']}").json()
    assert run["status"] == "completed" and run["evidence_mode"] == "live"


def test_force_refresh_bypasses_matching_cache(api):
    client, _ = api
    extraction, handoff = _stages()
    with patch("ai.pipeline.generate_json", side_effect=[extraction, handoff, extraction, handoff]):
        first = client.post("/analyses", json={"patient_id": "sarah-001"})
        refreshed = client.post("/analyses", json={"patient_id": "sarah-001", "force_refresh": True})
    assert refreshed.status_code == 202
    assert refreshed.json()["run_id"] != first.json()["run_id"]


def test_outer_timeout_cancels_queued_work_and_budget(api):
    from concurrent.futures import Future
    from unittest.mock import Mock

    client, _ = api
    future = Mock(spec=Future)
    future.result.side_effect = TimeoutError("Simulated deadline")
    with patch("app.analyses._executor.submit", return_value=future) as submit:
        created = client.post("/analyses", json={"patient_id": "sarah-001"})
    assert submit.call_args.args[-1].cancelled.is_set()
    future.cancel.assert_called_once()
    run = client.get(f"/analyses/{created.json()['run_id']}").json()
    assert run["status"] == "failed" and run["error"]["code"] == "timeout"


@pytest.mark.parametrize("fallback", ["outage", "no_matches"])
def test_pubmed_recovers_after_cached_fallback(monkeypatch, api, fallback):
    from ai.pubmed import PubMedError

    client, _ = api
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "pubmed")
    extraction, handoff = _stages()
    first_lookup = PubMedError("Temporary outage.") if fallback == "outage" else []
    with patch("ai.pipeline.generate_json", side_effect=[extraction, handoff, extraction, handoff]) as generate, \
         patch("ai.pubmed.rank_registered", side_effect=[first_lookup, ["20301469", "29112785"]]) as lookup:
        first = client.post("/analyses", json={"patient_id": "sarah-001"}).json()
        assert client.get(f"/analyses/{first['run_id']}").json()["evidence_mode"] == "cached"
        recovered = client.post("/analyses", json={"patient_id": "sarah-001"})
    assert recovered.status_code == 202
    assert recovered.json()["run_id"] != first["run_id"]
    run = client.get(f"/analyses/{recovered.json()['run_id']}").json()
    assert run["status"] == "completed" and run["evidence_mode"] == "live"
    assert lookup.call_count == 2 and generate.call_count == 4
    with patch("ai.pubmed.rank_registered") as lookup, patch("ai.pipeline.generate_json") as generate:
        reused = client.post("/analyses", json={"patient_id": "sarah-001"})
    assert reused.status_code == 200 and reused.json()["run_id"] == run["run_id"]
    lookup.assert_not_called()
    generate.assert_not_called()


@pytest.mark.parametrize("status", ["queued", "running"])
def test_pubmed_deduplicates_in_progress_requests(monkeypatch, api, status):
    from app.analyses import start_analysis
    from app.contracts import AnalysisRequest

    _, fake = api
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "pubmed")
    request = AnalysisRequest(patient_id="sarah-001")
    run, needs_execution = start_analysis(request)
    assert needs_execution
    run.status = status
    fake.save_run(run)
    reused, needs_execution = start_analysis(request)
    assert reused.run_id == run.run_id and not needs_execution


@pytest.mark.parametrize("name,value", [
    ("EVIDENCE_RETRIEVAL", "invalid"),
    ("ANALYSIS_TIMEOUT_SECONDS", "many"), ("ANALYSIS_TIMEOUT_SECONDS", "0"),
    ("ANALYSIS_TIMEOUT_SECONDS", "-1"), ("ANALYSIS_TIMEOUT_SECONDS", "nan"),
    ("ANALYSIS_TIMEOUT_SECONDS", "inf"), ("GEMINI_TIMEOUT_SECONDS", "many"),
    ("SUPABASE_SERVICE_ROLE_KEY", ""), ("PUBMED_TIMEOUT_SECONDS", "nan"),
])
def test_invalid_settings_return_actionable_503_before_database_or_provider(monkeypatch, api, name, value):
    client, fake = api
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "pubmed")
    monkeypatch.setenv(name, value)
    with patch("app.db.get_patient") as get_patient, patch("ai.pipeline.generate_json") as generate:
        response = client.post("/analyses", json={"patient_id": "sarah-001"})
    assert response.status_code == 503
    detail = response.json()["detail"]
    assert detail["code"] == "configuration_error" and not detail["retryable"]
    assert name in detail["message"]
    assert fake.runs == {}
    get_patient.assert_not_called()
    generate.assert_not_called()
    with patch("app.db.ping") as ping:
        assert client.get("/health").status_code == 503
    ping.assert_not_called()


def test_configuration_changed_after_queue_is_non_retryable(monkeypatch, api):
    from app.analyses import execute_run, start_analysis
    from app.contracts import AnalysisRequest

    _, fake = api
    run, _ = start_analysis(AnalysisRequest(patient_id="sarah-001"))
    monkeypatch.setenv("ANALYSIS_TIMEOUT_SECONDS", "0")
    with patch("ai.pipeline.generate_json") as generate:
        execute_run(run.run_id)
    failed = fake.get_run(run.run_id)
    assert failed.status == "failed" and failed.error.code == "internal"
    assert not failed.error.retryable and "Configuration error" in failed.error.message
    generate.assert_not_called()


def test_pubmed_deadline_stops_run_without_cache_fallback_or_handoff(monkeypatch, api):
    from ai.budget import AnalysisDeadlineExceeded

    client, _ = api
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "pubmed")
    extraction, _ = _stages()
    with patch("ai.pipeline.generate_json", return_value=extraction) as generate, \
         patch("ai.pubmed.rank_registered", side_effect=AnalysisDeadlineExceeded("Deadline reached.")):
        created = client.post("/analyses", json={"patient_id": "sarah-001"})
    run = client.get(f"/analyses/{created.json()['run_id']}").json()
    assert run["status"] == "failed" and run["error"]["code"] == "timeout"
    assert run["output"] is None and generate.call_count == 1


ORIGIN = {"Origin": "http://localhost:3000"}


def test_unhandled_error_is_json_and_has_cors(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("db exploded")

    monkeypatch.setattr(db, "list_patients", boom)
    r = TestClient(app, raise_server_exceptions=False).get("/patients", headers=ORIGIN)
    assert r.status_code == 500
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert r.json() == {"detail": {"code": "internal", "message": "Unexpected server error.", "retryable": True}}
    assert "db exploded" not in r.text


def test_handled_errors_keep_cors(monkeypatch, api):
    from ai.configuration import ConfigurationError

    client, _ = api
    missing = client.get("/sources/nope", headers=ORIGIN)
    assert missing.status_code == 404
    assert missing.headers["access-control-allow-origin"] == "http://localhost:3000"

    def misconfigured(*a, **k):
        raise ConfigurationError("missing key")

    monkeypatch.setattr(db, "get_source", misconfigured)
    r = client.get("/sources/any", headers=ORIGIN)
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "configuration_error"
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
