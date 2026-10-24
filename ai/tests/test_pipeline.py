"""Offline contract integration checks. All model calls below are mocked."""

import re
from copy import deepcopy
from unittest.mock import patch

import pytest

from app.config import get_settings
from app.contracts import AnalysisOutput
from app.data_files import load_fixture_output, load_patient_files, load_source_registry
from app.pipeline import RetrievalFailed, run_pipeline
from app.validation import AnalysisReferenceError
from ai.gemini_client import GeminiRequestError, Settings
from ai.pipeline import analyze_patient, extract_findings


@pytest.fixture
def sarah():
    return next(p for p in load_patient_files() if p.patient_id == "sarah-001")


@pytest.fixture
def sample():
    # This fixture tests the transport/contract only; it is never a runtime fallback.
    return load_fixture_output("sarah-001").model_dump(mode="json")


@pytest.fixture
def test_sources():
    # The reviewed registry (backend/data/sources.json, evidence-2026-10-24.1).
    sources = load_source_registry().sources
    assert all(s.verification_status == "verified" for s in sources)
    return sources


def stage_responses(sample):
    handoff = deepcopy(sample)
    findings = handoff.pop("findings")
    return {"findings": findings}, handoff


def test_backend_hook_returns_exact_shared_type(sarah, sample, test_sources):
    extraction, handoff = stage_responses(sample)
    with patch("ai.pipeline.generate_json", side_effect=[extraction, handoff]) as generate:
        result = run_pipeline(sarah, test_sources)
    assert isinstance(result.output, AnalysisOutput)
    assert result.output.model_dump(mode="json") == sample
    assert result.evidence_mode == "cached"
    assert generate.call_count == 2
    first, second = [c.kwargs for c in generate.call_args_list]
    assert first["payload"]["patient"]["demographics"]["birth_year"] == 1986
    for stage in (first, second):
        docs = stage["payload"]["patient"]["documents"]
        assert all("observations" not in d and "observations_not_quotable" in d for d in docs)
    assert set(first["response_schema"]["properties"]) == {"findings"}
    assert "findings" not in second["response_schema"]["properties"]
    assert second["payload"]["findings"] == extraction["findings"]
    shown = second["payload"]["sources"]
    assert all("url" not in s for s in shown)
    assert all(e["cite_as"]["source_id"] == s["source_id"] for s in shown for e in s["excerpts"])


def test_unverified_registry_stops_before_any_model_call(sarah):
    unverified = [s.model_copy(update={"verification_status": "unverified"})
                  for s in load_source_registry().sources]
    with patch("ai.pipeline.generate_json") as generate:
        with pytest.raises(RetrievalFailed, match="No verified sources"):
            run_pipeline(sarah, unverified)
    generate.assert_not_called()


def test_placeholder_marked_verified_is_still_not_evidence(sarah, test_sources):
    source = test_sources[0]
    flipped = source.model_copy(update={"excerpts": [
        source.excerpts[0].model_copy(update={"text": "[Unverified paraphrase] something"})
    ]})
    with patch("ai.pipeline.generate_json") as generate:
        with pytest.raises(RetrievalFailed, match="No verified sources"):
            run_pipeline(sarah, [flipped])
    generate.assert_not_called()


@pytest.mark.parametrize("invalid_quote", ["", "patient has a confirmed genetic diagnosis"])
def test_invalid_extraction_quote_stops_before_synthesis(sarah, sample, test_sources, invalid_quote):
    extraction, _ = stage_responses(sample)
    extraction["findings"][0]["record_refs"][0]["excerpt"] = invalid_quote
    with patch("ai.pipeline.generate_json", return_value=extraction) as generate:
        with pytest.raises(AnalysisReferenceError, match="not verbatim"):
            analyze_patient(sarah, test_sources)
    assert generate.call_count == 1


def test_excluded_document_cannot_reenter_via_model(sarah, sample):
    extraction, _ = stage_responses(sample)
    excluded = extraction["findings"][0]["record_refs"][0]["record_id"]
    filtered = sarah.model_copy(update={"documents": [d for d in sarah.documents if d.record_id != excluded]})
    with patch("ai.pipeline.generate_json", return_value=extraction):
        with pytest.raises(AnalysisReferenceError, match="unknown or excluded"):
            extract_findings(filtered)


def test_duplicate_finding_ids_are_rejected(sarah, sample):
    extraction, _ = stage_responses(sample)
    extraction["findings"].append(deepcopy(extraction["findings"][0]))
    with patch("ai.pipeline.generate_json", return_value=extraction):
        with pytest.raises(AnalysisReferenceError, match="duplicate finding"):
            extract_findings(sarah)


def _rejected_twice(sarah, sources, extraction, bad, match):
    """A bad handoff gets one correction attempt; a repeat is rejected, never patched."""
    with patch("ai.pipeline.generate_json", side_effect=[extraction, bad, deepcopy(bad)]) as generate:
        with pytest.raises(AnalysisReferenceError, match=match):
            run_pipeline(sarah, sources)
    assert generate.call_count == 3
    retry_payload = generate.call_args_list[2].kwargs["payload"]
    assert any(re.search(match, e) for e in retry_payload["validation_errors_from_previous_attempt"])


def test_unregistered_source_cannot_reach_backend(sarah, sample, test_sources):
    extraction, handoff = stage_responses(sample)
    handoff["claims"][0]["source_refs"][0]["source_id"] = "src-invented"
    _rejected_twice(sarah, test_sources, extraction, handoff, "unknown source")


def test_blank_final_quote_is_rejected(sarah, sample, test_sources):
    extraction, handoff = stage_responses(sample)
    handoff["claims"][0]["record_refs"][0]["excerpt"] = ""
    _rejected_twice(sarah, test_sources, extraction, handoff, "must not be blank")


def test_prior_result_limitation_must_concern_that_test(sarah, sample, test_sources):
    # Seen in a real run: the enzyme review's limitation pointed at a symptom claim.
    extraction, handoff = stage_responses(sample)
    handoff["prior_results"][0]["limitation_claim_ids"] = ["clm-features-match"]
    _rejected_twice(sarah, test_sources, extraction, handoff, "do not cite the test's own records")


def test_competing_explanations_cannot_share_a_claim(sarah, sample, test_sources):
    # Seen in a real run: the common alternative rested on rare-disease evidence.
    extraction, handoff = stage_responses(sample)
    handoff["hypotheses"][1]["supporting_claim_ids"].append("clm-features-match")
    _rejected_twice(sarah, test_sources, extraction, handoff, "supports both")


def test_existing_reports_are_checked_before_new_information(sarah, sample, test_sources):
    extraction, handoff = stage_responses(sample)
    existing, new = handoff["missing_evidence"]
    assert existing["check_existing_first"] and not new["check_existing_first"]
    existing["priority"], new["priority"] = 2, 1
    _rejected_twice(sarah, test_sources, extraction, handoff, "lower priority numbers")


def test_check_existing_first_needs_a_record_reason(sarah, sample, test_sources):
    extraction, handoff = stage_responses(sample)
    handoff["missing_evidence"][0]["existing_record_refs"] = []
    _rejected_twice(sarah, test_sources, extraction, handoff, "needs existing_record_refs")


def test_explanation_without_any_evidence_is_rejected(sarah, sample, test_sources):
    # Seen in a real James run: a rare-disease explanation with no linked claims.
    extraction, handoff = stage_responses(sample)
    handoff["hypotheses"][1]["supporting_claim_ids"] = []
    handoff["hypotheses"][1]["contradicting_claim_ids"] = []
    _rejected_twice(sarah, test_sources, extraction, handoff, "link at least one")


def test_schema_drift_gets_one_correction_without_echoing_values(sarah, sample, test_sources):
    extraction, handoff = stage_responses(sample)
    drifted = deepcopy(handoff)
    drifted["claims"][0]["confidence"] = "SECRET-LIKE VALUE"
    with patch("ai.pipeline.generate_json", side_effect=[extraction, drifted, handoff]) as generate:
        result = run_pipeline(sarah, test_sources)
    assert result.output.model_dump(mode="json")["claims"] == handoff["claims"]
    errors = generate.call_args_list[2].kwargs["payload"]["validation_errors_from_previous_attempt"]
    assert errors and not any("SECRET-LIKE VALUE" in e for e in errors)


def test_model_failure_is_raised_without_fixture_fallback(sarah, test_sources):
    with patch("ai.pipeline.generate_json", side_effect=GeminiRequestError("Service unavailable")):
        with pytest.raises(GeminiRequestError, match="Service unavailable"):
            run_pipeline(sarah, test_sources)


@pytest.mark.parametrize("override, expected", [
    ("", "gemini-test-model"),
    ("not-configured", "gemini-test-model"),
    ("explicit-test-model", "explicit-test-model"),
])
def test_actual_model_and_cache_metadata_match(override, expected):
    env = {"SUPABASE_SERVICE_ROLE_KEY": "test-only", "GEMINI_MODEL": "gemini-test-model", "MODEL_NAME": override}
    with patch.dict("os.environ", env, clear=True), patch("ai.gemini_client.load_dotenv"):
        assert Settings.from_env(require_key=False).model == expected
        assert get_settings().model == expected
