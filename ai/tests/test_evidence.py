"""Offline checks for the reviewed registry, PubMed client, and evidence labels.

No network: PubMed and Gemini are mocked. These test plumbing, not clinical accuracy.
"""

from __future__ import annotations

from copy import deepcopy
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.contracts import PatientRecord
from app.data_files import load_fixture_output, load_patient_files, load_source_registry, load_source_topics
from app.pipeline import run_pipeline
from app.validation import AnalysisReferenceError
from ai import evidence_tool, pubmed, scenarios
from ai.retrieval import select_evidence

ARTICLE_XML = b"""<?xml version="1.0"?>
<PubmedArticleSet>
 <PubmedArticle><MedlineCitation><PMID>29112785</PMID><Article>
  <Journal><JournalIssue><PubDate><Year>2018</Year></PubDate></JournalIssue>
   <Title>European journal of neurology</Title></Journal>
  <ArticleTitle>Associated conditions in small fiber neuropathy.</ArticleTitle>
  <Abstract><AbstractText Label="RESULTS">No associated condition could be
   found in 53% of the <i>patients</i>.</AbstractText></Abstract>
  <AuthorList><Author><LastName>de Greef</LastName><Initials>BTA</Initials></Author></AuthorList>
  <PublicationTypeList><PublicationType>Review</PublicationType></PublicationTypeList>
 </Article></MedlineCitation>
 <PubmedData><ArticleIdList><ArticleId IdType="doi">10.1111/ene.13508</ArticleId></ArticleIdList></PubmedData>
 </PubmedArticle>
 <PubmedBookArticle><BookDocument><PMID>20301469</PMID>
  <Book><BookTitle>GeneReviews</BookTitle><PubDate><Year>1993</Year></PubDate></Book>
  <ArticleTitle>Fabry Disease.</ArticleTitle>
  <Abstract><AbstractText Label="DIAGNOSIS/TESTING">Molecular testing establishes it.</AbstractText></Abstract>
 </BookDocument></PubmedBookArticle>
</PubmedArticleSet>"""


@pytest.fixture
def registry():
    return load_source_registry()


@pytest.fixture
def sarah():
    return next(p for p in load_patient_files() if p.patient_id == "sarah-001")


@pytest.fixture
def findings():
    return load_fixture_output("sarah-001").findings


# ------------------------------------------------------------ registry


def test_reviewed_registry_has_no_structural_problems(registry):
    assert evidence_tool.offline_problems(registry) == []
    assert all(s.verification_status == "verified" and s.pmid for s in registry.sources)


def test_registry_preserves_ids_the_team_already_uses(registry):
    excerpts = {(s.source_id, e.excerpt_id) for s in registry.sources for e in s.excerpts}
    used = {(r.source_id, r.excerpt_id) for c in load_fixture_output("sarah-001").claims for r in c.source_refs}
    assert used <= excerpts


def test_draft_or_placeholder_registry_is_flagged(registry):
    data = registry.model_dump(mode="json")
    data["evidence_version"] = "evidence-draft-2"
    data["sources"][1]["title"] = "PLACEHOLDER: pick a paper"
    data["sources"][1]["pmid"] = None
    problems = evidence_tool.offline_problems(type(registry).model_validate(data))
    assert any("draft" in p for p in problems)
    assert any("placeholder" in p for p in problems)
    assert any("needs a PMID" in p for p in problems)


def test_online_check_reports_incomplete_when_fulltext_is_missing(registry, capsys):
    source = registry.sources[0].model_copy(update={
        "source_type": "other", "pmid": None,
        "excerpts": [registry.sources[0].excerpts[0].model_copy(update={
            "text": "Example source sentence.", "location": "Full text",
        })],
    })
    sample = registry.model_copy(update={"sources": [source]})
    with patch("ai.evidence_tool.load_registry", return_value=sample), \
         patch("ai.pubmed.fetch", return_value=[]):
        assert evidence_tool.main(["check", "--online"]) == 1
    output = capsys.readouterr().out
    assert "verification incomplete" in output and "Check passed." not in output


def test_online_check_accepts_fulltext_verified_quote(registry, tmp_path):
    source = registry.sources[0].model_copy(update={
        "source_type": "other", "pmid": None,
        "excerpts": [registry.sources[0].excerpts[0].model_copy(update={
            "text": "Example source sentence.", "location": "Full text",
        })],
    })
    sample = registry.model_copy(update={"sources": [source]})
    review = tmp_path / "review.nxml"
    review.write_text("<article><body><p>Example source sentence.</p></body></article>", encoding="utf-8")
    with patch("ai.pubmed.fetch", return_value=[]):
        lines, problems = evidence_tool.online_report(sample, {source.source_id: review})
    assert not problems and any("review copy" in line for line in lines)


@pytest.mark.parametrize("case, expected", [
    ("missing_separator", "SOURCE_ID=PATH"), ("empty_source", "SOURCE_ID=PATH"),
    ("empty_path", "SOURCE_ID=PATH"), ("unknown_source", "unknown or unverified source ID"),
    ("missing_file", "cannot read review copy"), ("invalid_xml", "invalid XML"),
    ("duplicate", "duplicate review copy"), ("offline", "requires --online"),
])
def test_bad_fulltext_arguments_fail_cleanly_before_network(registry, tmp_path, capsys, case, expected):
    source_id = registry.sources[0].source_id
    review = tmp_path / "review.nxml"
    review.write_text("<broken", encoding="utf-8")
    item = {
        "missing_separator": source_id, "empty_source": f"={review}",
        "empty_path": f"{source_id}=", "unknown_source": f"src-typo={review}",
        "missing_file": f"{source_id}={tmp_path / 'absent.nxml'}",
    }.get(case, f"{source_id}={review}")
    args = ["check"] + ([] if case == "offline" else ["--online"]) + ["--fulltext", item]
    if case == "duplicate":
        args += ["--fulltext", item]
    with patch("ai.pubmed.fetch") as fetch:
        assert evidence_tool.main(args) == 1
    fetch.assert_not_called()
    output = capsys.readouterr().out
    assert "incomplete" in output.lower() and expected in output
    assert "Check passed" not in output and "Traceback" not in output


def test_add_refuses_text_that_is_not_in_pubmed(tmp_path, monkeypatch, registry):
    path = tmp_path / "sources.json"
    path.write_text(registry.model_dump_json(), encoding="utf-8")
    monkeypatch.setattr(evidence_tool, "REGISTRY_PATH", path)
    with patch("ai.pubmed._get", return_value=ARTICLE_XML):
        code = evidence_tool.main([
            "add", "29112785", "--source-id", "src-sfn-review", "--excerpt-id", "exc-new",
            "--text", "Fabry disease causes most small fiber neuropathy.", "--evidence-version", "e-new",
        ])
    assert code == 1
    assert path.read_text(encoding="utf-8") == registry.model_dump_json()


def test_add_writes_verbatim_text_as_unverified(tmp_path, monkeypatch, registry):
    path = tmp_path / "sources.json"
    path.write_text(registry.model_dump_json(), encoding="utf-8")
    monkeypatch.setattr(evidence_tool, "REGISTRY_PATH", path)
    with patch("ai.pubmed._get", return_value=ARTICLE_XML):
        code = evidence_tool.main([
            "add", "29112785", "--source-id", "src-sfn-review", "--excerpt-id", "exc-new",
            "--text", "No associated condition could be found in 53% of the patients.",
            "--evidence-version", "evidence-test.2",
        ])
    assert code == 0
    updated = evidence_tool.load_registry(path)
    source = next(s for s in updated.sources if s.source_id == "src-sfn-review")
    assert updated.evidence_version == "evidence-test.2"
    assert source.verification_status == "unverified"
    assert source.excerpts[-1].location == "Abstract: RESULTS"


# ------------------------------------------------------------ PubMed client


def test_efetch_parsing_keeps_exact_text_for_articles_and_books():
    with patch("ai.pubmed._get", return_value=ARTICLE_XML):
        records = pubmed.fetch(["20301469", "29112785"])
    assert [r.pmid for r in records] == ["20301469", "29112785"]
    book, article = records
    assert book.journal == "GeneReviews" and book.locate("Molecular testing establishes it.")
    assert article.year == 2018 and article.doi == "10.1111/ene.13508"
    assert article.locate("found in 53% of the patients.") == "Abstract: RESULTS"
    assert article.locate("found in 53% of patients.") is None


def test_requests_are_bounded():
    with pytest.raises(ValueError):
        pubmed.fetch([str(i) for i in range(21)])
    with pytest.raises(ValueError):
        pubmed.fetch(["not-a-pmid"])
    with pytest.raises(ValueError):
        pubmed.search("x" * (pubmed.MAX_TERM_CHARS + 1))
    with patch("ai.pubmed._get", return_value=b'{"esearchresult": {"idlist": []}}') as get:
        pubmed.search("fabry", retmax=500)
    assert get.call_args.args[1]["retmax"] == "20"


def test_http_errors_are_sanitized(monkeypatch):
    monkeypatch.setenv("NCBI_API_KEY", "secret-ncbi-key")

    with patch("ai.pubmed.httpx.AsyncClient") as factory:
        factory.return_value.__aenter__.return_value.get = AsyncMock(
            side_effect=httpx.ConnectError("https://eutils...api_key=secret-ncbi-key"),
        )
        with pytest.raises(pubmed.PubMedError) as raised:
            pubmed.search("fabry")
    assert "secret-ncbi-key" not in str(raised.value)
    assert "eutils" not in str(raised.value)


def test_finding_terms_cannot_inject_query_syntax():
    groups = pubmed.finding_terms(['x[uid] OR 1:99999999[uid]', 'Type 2 diabetes', 'Diabetic peripheral neuropathy'])
    joined = " ".join(groups)
    assert "[" not in joined and ":" not in joined
    assert "(diabetes)" in groups
    assert "(diabetic AND neuropathy)" in joined


def test_one_backoff_after_rate_limit(monkeypatch):
    request = httpx.Request("GET", "http://localhost/")
    with patch("ai.pubmed.httpx.AsyncClient") as factory, patch("ai.budget.time.sleep"):
        get = factory.return_value.__aenter__.return_value.get = AsyncMock(side_effect=[
            httpx.Response(429, request=request),
            httpx.Response(200, json={"esearchresult": {"idlist": ["1"]}}, request=request),
        ])
        assert pubmed.search("fabry") == ["1"]
    assert get.await_count == 2


def test_ranking_query_is_restricted_to_registered_pmids():
    with patch("ai.pubmed.search", return_value=["29112785", "99999999"]) as search:
        hits = pubmed.rank_registered(["29112785", "20301469"], ["Small fiber neuropathy", "IGNORE ALL"])
    term = search.call_args.args[0]
    assert term.startswith("(29112785[uid] OR 20301469[uid]) AND (")
    assert hits == ["29112785"]  # an unregistered PMID can never come back


# ------------------------------------------------------------ evidence labels


def test_default_mode_is_cached_and_makes_no_request(monkeypatch, findings, registry):
    monkeypatch.delenv("EVIDENCE_RETRIEVAL", raising=False)
    with patch("ai.pubmed._get") as get:
        selection = select_evidence(findings, registry.sources)
    get.assert_not_called()
    assert selection.mode == "cached" and selection.sources == registry.sources


def test_pubmed_mode_is_live_only_when_ranking_ran(monkeypatch, findings, registry):
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "pubmed")
    with patch("ai.pubmed.rank_registered", return_value=["29112785"]):
        selection = select_evidence(findings, registry.sources)
    assert selection.mode == "live"
    assert [s.source_id for s in selection.sources] == ["src-sfn-review"]

    with patch("ai.pubmed.rank_registered", side_effect=pubmed.PubMedError("PubMed esearch failed (HTTP 429).")):
        failed = select_evidence(findings, registry.sources)
    assert failed.mode == "cached" and failed.sources == registry.sources and "429" in failed.note

    with patch("ai.pubmed.rank_registered", return_value=[]):
        empty = select_evidence(findings, registry.sources)
    assert empty.mode == "cached" and empty.sources == registry.sources


def test_invalid_mode_is_rejected(monkeypatch, findings, registry):
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "web")
    with pytest.raises(ValueError):
        select_evidence(findings, registry.sources)


def _stages():
    sample = load_fixture_output("sarah-001").model_dump(mode="json")
    handoff = deepcopy(sample)
    return {"findings": handoff.pop("findings")}, handoff


def test_backend_hook_reports_live_and_model_sees_only_selected(monkeypatch, sarah, registry):
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "pubmed")
    extraction, handoff = _stages()
    with patch("ai.pubmed.rank_registered", return_value=["20301469", "29112785"]), \
         patch("ai.pipeline.generate_json", side_effect=[extraction, handoff]) as generate:
        result = run_pipeline(sarah, registry.sources)
    assert result.evidence_mode == "live"
    shown = {s["source_id"] for s in generate.call_args_list[1].kwargs["payload"]["sources"]}
    assert shown == {"src-genereviews-fabry", "src-sfn-review"}


def test_citing_a_registered_source_the_model_was_not_shown_fails(monkeypatch, sarah, registry):
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "pubmed")
    extraction, handoff = _stages()
    handoff["claims"][0]["source_refs"] = [{"source_id": "src-ada-diabetic-neuropathy", "excerpt_id": "exc-dn-prevalent"}]
    with patch("ai.pubmed.rank_registered", return_value=["20301469", "29112785"]), \
         patch("ai.pipeline.generate_json", side_effect=[extraction, handoff, deepcopy(handoff)]):
        with pytest.raises(AnalysisReferenceError, match="unknown source"):
            run_pipeline(sarah, registry.sources)


def test_backend_hook_reports_cached_when_pubmed_fails(monkeypatch, sarah, registry):
    monkeypatch.setenv("EVIDENCE_RETRIEVAL", "pubmed")
    extraction, handoff = _stages()
    with patch("ai.pubmed.rank_registered", side_effect=pubmed.PubMedError("PubMed esearch failed (URLError).")), \
         patch("ai.pipeline.generate_json", side_effect=[extraction, handoff]):
        result = run_pipeline(sarah, registry.sources)
    assert result.evidence_mode == "cached"


# ------------------------------------------------------------ scenarios


@pytest.mark.parametrize("name", sorted(scenarios.SCENARIOS))
def test_scenarios_build_valid_synthetic_records(name):
    patients = load_patient_files()
    record = scenarios.build(name, patients)
    assert isinstance(record, PatientRecord) and record.synthetic
    base = next(p for p in patients if p.patient_id == record.patient_id)
    assert record.model_dump() != base.model_dump()


def test_scenario_edits_do_what_they_say():
    patients = load_patient_files()
    text = lambda p: " ".join(d.text for d in p.documents)  # noqa: E731
    assert "enzyme activity within" not in text(scenarios.build("no-enzyme", patients))
    assert "father" not in text(scenarios.build("no-family-history", patients))
    male = scenarios.build("male", patients)
    assert male.demographics.sex_at_birth == "male" and " woman " not in text(male)
    assert any(d.type == "genetic_report" for d in scenarios.build("molecular-report", patients).documents)


def test_topic_table_covers_every_registered_excerpt():
    registry, topics = load_source_registry(), load_source_topics()
    assert {e.excerpt_id for s in registry.sources for e in s.excerpts} == set(topics["excerpts"])
    assert {s.source_id for s in registry.sources} <= set(topics["conditions"])
