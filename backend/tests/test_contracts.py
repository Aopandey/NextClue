"""Offline checks on the contracts and data files (no Supabase needed)."""

from __future__ import annotations

import pytest

from app.contracts import AnalysisOutput
from app.data_files import load_fixture_output, load_patient_files, load_source_registry
from app.validation import compute_cache_key, find_reference_errors
from app.views import build_graph, build_timeline


@pytest.fixture(scope="module")
def sarah():
    return next(p for p in load_patient_files() if p.patient_id == "sarah-001")


@pytest.fixture(scope="module")
def sources():
    return load_source_registry().sources


@pytest.fixture(scope="module")
def fixture_output():
    return load_fixture_output("sarah-001")


def test_all_patient_files_are_synthetic_and_unique():
    patients = load_patient_files()
    assert len(patients) >= 2
    assert all(p.synthetic for p in patients)
    for p in patients:
        ids = [d.record_id for d in p.documents]
        assert len(ids) == len(set(ids)), p.patient_id


def test_fixture_references_resolve(fixture_output, sarah, sources):
    assert find_reference_errors(fixture_output, sarah, sources) == []


def test_graph_stays_small(fixture_output):
    graph = build_graph(fixture_output)
    node_ids = {n.node_id for n in graph.nodes}
    assert 8 <= len(graph.nodes) <= 12
    assert all(e.source in node_ids and e.target in node_ids for e in graph.edges)


def test_timeline_is_sorted_and_complete(fixture_output, sarah):
    timeline = build_timeline(fixture_output, sarah)
    assert [e.date for e in timeline] == sorted(e.date for e in timeline)
    assert len(timeline) == len(sarah.documents)


def test_invented_excerpt_is_rejected(fixture_output, sarah, sources):
    data = fixture_output.model_dump(mode="json")
    data["findings"][0]["record_refs"][0]["excerpt"] = "patient has angiokeratomas"
    errors = find_reference_errors(AnalysisOutput.model_validate(data), sarah, sources)
    assert any("not verbatim" in e for e in errors)


def test_unknown_ids_are_rejected(fixture_output, sarah, sources):
    data = fixture_output.model_dump(mode="json")
    data["claims"][0]["source_refs"][0]["excerpt_id"] = "exc-made-up"
    data["hypotheses"][0]["supporting_claim_ids"].append("clm-missing")
    errors = find_reference_errors(AnalysisOutput.model_validate(data), sarah, sources)
    assert any("exc-made-up" in e for e in errors)
    assert any("clm-missing" in e for e in errors)


def test_excluded_record_cannot_be_cited(fixture_output, sarah, sources):
    errors = find_reference_errors(fixture_output, sarah, sources, excluded_record_ids=["rec-2024-pcp"])
    assert any("rec-2024-pcp" in e for e in errors)


def test_rare_only_hypotheses_are_rejected(fixture_output, sarah, sources):
    data = fixture_output.model_dump(mode="json")
    data["hypotheses"] = [h for h in data["hypotheses"] if h["is_rare_disease"]]
    for m in data["missing_evidence"]:
        m["hypothesis_ids"] = [h for h in m["hypothesis_ids"] if h == "hyp-fabry"]
    errors = find_reference_errors(AnalysisOutput.model_validate(data), sarah, sources)
    assert any("non-rare" in e for e in errors)


def test_cache_key_changes_with_any_input(sarah):
    base = dict(schema_version="analysis.v1", model="m", prompt_version="p", evidence_version="e")
    key = compute_cache_key(sarah, [], **base)
    assert key == compute_cache_key(sarah, [], **base)
    assert key != compute_cache_key(sarah, ["rec-2024-pcp"], **base)
    assert key != compute_cache_key(sarah, [], **{**base, "model": "m2"})
    assert key == compute_cache_key(sarah, [], retrieval_mode="cached", **base)
    assert key != compute_cache_key(sarah, [], retrieval_mode="pubmed", **base)

    edited = sarah.model_copy(deep=True)
    edited.documents[0].text += " Edited."
    assert key != compute_cache_key(edited, [], **base)
