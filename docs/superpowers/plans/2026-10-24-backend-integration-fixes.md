# Backend Integration Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six backend/AI/data issues found while integrating the health-screen frontend with `main`'s backend: B1 atomic run reuse, B2 claim-source relevance, B3 outcome wording, B4 fixture record ref, B5 CORS on errors, B6 graph scope.

**Architecture:** Every change stays inside the existing FastAPI backend (`backend/app`), the AI pipeline (`ai/`), the data files (`backend/data`) and one new Supabase migration. The shared contract does NOT change: no edits to `backend/app/contracts.py`, `contracts/schema/*.json`, or the API routes. The new rules plug into the existing validation path (`find_reference_errors` → `check_output` → one correction retry), so the frontend needs no change.

**Tech Stack:** Python 3.11+ (venv), FastAPI, Pydantic v2, supabase-py / postgrest 2.33, pytest. Gemini only via `ai.pipeline.generate_json`, which tests always mock.

**Spec:** The six asks are on `.lavish/nextclue-integration.html`, in the health-screen checkout `/Users/mikehuynh/Documents/NextClue`, with live evidence. Backend rules come from `CLAUDE.md` on `main` (integration guide) and `backend/README.md`. Saved live runs used as evidence: `run-sarah-001.json` and `run-james-002.json`, copied beside the handoff (see the handoff's Pointers).

## Global Constraints

- Work on a branch cut from `origin/main` (91895fb or later). Never commit on `main`. Never push or merge without the user's OK.
- Contracts are frozen: no change to `backend/app/contracts.py`, `contracts/`, route paths, or response shapes (the one exception is the new 500 body in Task 1, which reuses the existing `{"detail":{"code","message","retryable"}}` shape).
- Tests run offline: `cd <worktree> && .venv/bin/python -m pytest -q` (pytest.ini loads `ai.tests.isolation`, which blocks network and `.env` loading). Baseline before any change: **120 passed, 7 subtests passed**.
- Never call Gemini, `POST /analyses` with `force_refresh: true`, or the hosted Supabase from the agent. Never print or commit `backend/.env` / `ai/.env` values.
- Never apply a migration to the hosted Supabase. Daniel owns it; Task 2 ships the SQL file plus the instructions.
- Bump `PROMPT_VERSION` once, in Task 5, from `extract-v3+handoff-v3` to `extract-v3+handoff-v4` (default in `backend/app/config.py`, `backend/.env.example`, README mentions). It is part of the cache key, so old runs stop being reused: expect fresh Gemini runs on the next request.
- Record this work as Claude work in `ai/kiro-usage.md` if it lists contributions (CLAUDE.md: "do not attribute it to Kiro").
- One commit per task, `fix(backend): …` / `fix(ai): …` / `docs: …`, staging files by path.

## Review Focus

1. **`force_refresh` while a run for the same cache key is queued or running** returns that in-flight run (HTTP 200) and starts no second pipeline. Pinned in Task 2.
2. **The 500 body never leaks exception text** (Supabase URLs, keys, SQL). Pinned in Task 1 (`"db exploded" not in r.text`).
3. **The topic guard must not reject the shipped Sarah fixture** or correctly cited live claims. Pinned in Task 4 (`test_fixture_references_resolve` stays green; the live Sarah `clm-02` text passes Rule A).
4. **The wording check must not flag hedged fixture text** such as "pending clinician confirmation" or "Removes family history as supporting evidence". Pinned in Task 5 (parametrized cases).
5. **A stuck `queued`/`running` row** (server restarted mid-run, e.g. `uvicorn --reload`) used to block reuse for that cache key forever, and after Task 2 `force_refresh` could not escape it. Task 2b expires such rows lazily. Pinned in Task 2b.

## Decisions (user-approved 2026-10-24)

1. B1's index covers `queued`/`running` only (Daniel to confirm before applying the migration).
2. Stale in-flight rows: yes, a minimal lazy expiry in this branch (Task 2b). No cron, no sweep job, no schema change.
3. B3: strict ban, no source-backed exemption.
4. B6: document only.

---

### Task 1 (B5): JSON 500s keep CORS headers

**Files:**
- Modify: `backend/app/main.py` (around lines 21-27: `app = FastAPI(...)` then `app.add_middleware(CORSMiddleware, ...)`)
- Test: `ai/tests/test_api_flow.py` (or a new `ai/tests/test_cors.py`)

**Interfaces:**
- Produces: unhandled exceptions return `500 {"detail": {"code": "internal", "message": "Unexpected server error.", "retryable": true}}` with `Access-Control-Allow-Origin` for allowed origins.

- [ ] **Step 1: Write the failing tests**

```python
ORIGIN = {"Origin": "http://localhost:3000"}

def test_unhandled_error_is_json_and_has_cors(monkeypatch):
    def boom(*a, **k): raise RuntimeError("db exploded")
    monkeypatch.setattr(db, "list_patients", boom)
    r = TestClient(app, raise_server_exceptions=False).get("/patients", headers=ORIGIN)
    assert r.status_code == 500
    assert r.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert r.json() == {"detail": {"code": "internal", "message": "Unexpected server error.", "retryable": True}}
    assert "db exploded" not in r.text

def test_handled_errors_keep_cors(monkeypatch):
    # 404 from /sources/nope and the 503 configuration_error path both keep ACAO (regression guard)
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest -q ai/tests/test_api_flow.py -k cors`. Expected: the first test FAILS (no ACAO header, body "Internal Server Error"); the second passes.
- [ ] **Step 3: Implement `internal_error_with_cors(request, call_next)`** as `@app.middleware("http")` in `backend/app/main.py`, defined BEFORE the `add_middleware(CORSMiddleware, ...)` call. Middleware added first sits inside CORS; `@app.exception_handler(Exception)` does NOT work, because Starlette routes it to the outermost ServerErrorMiddleware. Log with `logger.exception(...)`. Never put `str(exc)` in the body.
- [ ] **Step 4: Run** the same tests, then the full suite. Expected: PASS, 122 passed.
- [ ] **Step 5: Commit** `fix(backend): unhandled errors return JSON with CORS headers`

### Task 2 (B1): Atomic reuse of in-flight runs

**Files:**
- Create: `supabase/migrations/20261025000000_analysis_runs_inflight_unique.sql`
- Modify: `backend/app/db.py` (`insert_run`, ~lines 125-129), `backend/app/analyses.py` (`start_analysis` insert at ~line 115)
- Test: `ai/tests/test_api_flow.py` (`FakeDb` at lines 22-53, `api` fixture at lines 56-62)

**Interfaces:**
- Produces: `db.insert_run(run: AnalysisRun, input_key: str) -> tuple[AnalysisRun, bool]`, which returns `(run, True)` when inserted and `(existing_in_flight_run, False)` on a unique violation. `start_analysis` returns `(run, inserted)` as its `(run, needs_execution)`.

**Decision baked in:** the unique index covers ONLY `status in ('queued','running')`, NOT `completed`. `force_refresh` and the PubMed cached→live retry intentionally insert a second live row next to a completed one. Including `completed` would break both, and the index could fail to create on hosted data that already has duplicate completed rows.

- [ ] **Step 1: Write the migration**

```sql
-- Pre-check (Daniel runs this on hosted first):
-- select cache_key, count(*) from analysis_runs
--  where provenance = 'live' and status in ('queued','running') group by 1 having count(*) > 1;
create unique index if not exists analysis_runs_cache_key_inflight
  on analysis_runs (cache_key) where provenance = 'live' and status in ('queued','running');
```

- [ ] **Step 2: Write the failing tests** in `ai/tests/test_api_flow.py`:
  - `test_concurrent_miss_returns_existing_in_flight_run`: create run A via `start_analysis(AnalysisRequest(patient_id="sarah-001"))` (queued, stored in `fake.runs`). Monkeypatch `db.find_reusable_run` to return `None` once, then delegate to fake. `FakeDb.insert_run` returns `(existing, False)` when a live queued/running run with the same `cache_key` exists. Call `start_analysis` again. Assert the returned `run_id == A.run_id` and `needs_execution is False`. Through the client, the second POST returns 200 and `generate_json` is not called again.
  - `test_insert_run_returns_existing_on_unique_violation`: unit test of the real `app.db.insert_run` with `monkeypatch.setattr(db, "client", lambda: fake_client)`. `fake_client` is a `MagicMock` whose `.table().insert().execute` raises `APIError({"message": "dup", "code": "23505", "hint": None, "details": None})` (`from postgrest.exceptions import APIError`), and whose select chain returns `[existing_row]`. Build `existing_row` from `run.model_dump(mode="json", exclude={"schema_version", "disclaimer"}) | {"input_key": "x"}`. Assert the result is `(existing, False)`.
  - `test_insert_run_reraises_other_api_errors`: code `"42501"` propagates.
  - `test_force_refresh_with_in_flight_run_returns_it`: with run A queued for Sarah, `start_analysis(AnalysisRequest(patient_id="sarah-001", force_refresh=True))` hits the unique violation in `FakeDb.insert_run`. Assert it returns A with `needs_execution is False`.
  - `test_migration_dedupes_only_in_flight_runs`: read the new SQL file. Assert it contains `status in ('queued','running')` and does not contain `'completed'`.
  - Existing `test_force_refresh_bypasses_matching_cache` and `test_pubmed_recovers_after_cached_fallback` must stay green. `FakeDb` rejects duplicates only for queued/running.
- [ ] **Step 3: Run** `.venv/bin/python -m pytest -q ai/tests/test_api_flow.py`. Expected: the new tests FAIL (signature/behaviour).
- [ ] **Step 4: Implement.** In `db.insert_run`: keep the fixture guard. Wrap the insert in `try/except APIError as exc`: if `exc.code != "23505"`, re-raise; otherwise re-select with `find_reusable_run(run.cache_key)` and return `(existing, False)` when it is queued/running. If the existing run is completed, return it as well; if nothing is found, re-raise. In `analyses.start_analysis`: `run, inserted = db.insert_run(...)`, then `return run, inserted`. Update `FakeDb.insert_run` to the same contract.
- [ ] **Step 5: Run** the full suite. Expected: PASS (baseline + new tests).
- [ ] **Step 6: Commit** `fix(backend): dedupe concurrent analysis runs on the cache key`. In the commit body, state: "Hosted DB: Daniel applies supabase/migrations/20261025000000_* after running the pre-check; deploy the code first, then the index."

### Task 2b: Expire stale in-flight runs

**Files:**
- Modify: `backend/app/analyses.py` (`start_analysis`, plus one small helper beside `_now`)
- Test: `ai/tests/test_api_flow.py`

**Interfaces:**
- Consumes: Task 2's `db.insert_run(...) -> tuple[AnalysisRun, bool]` and the existing `db.save_run`.
- Produces: `_expire_if_stale(run: AnalysisRun) -> bool` in `backend/app/analyses.py`. A run is stale when `status in ("queued", "running")` and `_now() - run.created_at > 2 * get_settings().analysis_timeout_seconds` seconds. `execute_run` already enforces the timeout, so a row that old has no live worker. When stale: set `status = "failed"`, `error = RunError(code="timeout", message="The analysis was interrupted before it finished.", retryable=True)`, `completed_at = _now()`, call `db.save_run(run)`, return `True`. Otherwise return `False` without writing.

**Keep it minimal:** no cron, background sweep, new setting, migration, or fallback replay. Expiry happens only on the two paths a request already takes.

- [ ] **Step 1: Write the failing tests** in `ai/tests/test_api_flow.py`, reusing `FakeDb` and the `api` fixture:
  - `test_stale_in_flight_run_is_expired_and_replaced`: store a live queued run for Sarah's cache key with `created_at` 3× the timeout in the past. `start_analysis(AnalysisRequest(patient_id="sarah-001"))` returns a NEW run with `needs_execution is True`, and the old row is now `failed` with `error.code == "timeout"`.
  - `test_force_refresh_escapes_stale_in_flight_run`: same stale row; `force_refresh=True` gets the unique violation from `FakeDb.insert_run`, expires the old row, retries the insert once, and returns a new run with `needs_execution is True`.
  - `test_fresh_in_flight_run_is_still_reused`: a queued run created just now is returned unchanged (`needs_execution is False`, status still `queued`). This guards Task 2's behaviour.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest -q ai/tests/test_api_flow.py`. Expected: the first two FAIL.
- [ ] **Step 3: Implement.** In `start_analysis`: after `existing = db.find_reusable_run(cache_key)`, treat `existing` as `None` when `_expire_if_stale(existing)` is true. After `stored, inserted = db.insert_run(...)`, if `not inserted and _expire_if_stale(stored)`, call `db.insert_run(...)` once more and return that result. One retry only; no loop.
- [ ] **Step 4: Run** the full suite. Expected: PASS.
- [ ] **Step 5: Commit** `fix(backend): expire analysis runs stuck in flight`

### Task 3 (B4): Sarah fixture cites the biopsy record

**Files:**
- Modify: `backend/data/fixtures/sarah-001.analysis-output.json`, claim `clm-sfn-often-idiopathic`
- Test: `backend/tests/test_contracts.py` (uses the existing `fixture_output` fixture)

- [ ] **Step 1: Write the failing test**

```python
def test_small_fiber_biopsy_record_is_cited_by_a_claim(fixture_output):
    finding = next(f for f in fixture_output.findings if f.finding_id == "fnd-small-fiber-neuropathy")
    claim_records = {r.record_id for c in fixture_output.claims for r in c.record_refs}
    assert {r.record_id for r in finding.record_refs} <= claim_records
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest -q backend/tests/test_contracts.py`. Expected: FAIL (`rec-2016-neuro` is not cited by any claim).
- [ ] **Step 3: Edit the JSON.** In `clm-sfn-often-idiopathic.record_refs`, APPEND `{"record_id": "rec-2016-neuro", "excerpt": "Etiology unclear"}` after the existing `rec-2016-neuro-fu` ref, so the first ref is unchanged. The text is verbatim in `backend/data/patients/sarah-001.json` rec-2016-neuro. No hypothesis edits are needed.
- [ ] **Step 4: Run** the full suite. Expected: PASS. `test_fixture_references_resolve` proves the excerpt is verbatim.
- [ ] **Step 5: Commit** `fix(data): Sarah fixture claim cites the 2016 biopsy record`

### Task 4 (B2): Claims may only cite excerpts about them

**Files:**
- Create: `backend/data/source_topics.json`
- Modify: `backend/app/data_files.py` (add `load_source_topics()` beside `load_source_registry`), `backend/app/validation.py` (new rule called at the end of `find_reference_errors`, ~lines 29-97), `ai/prompts/handoff.md` ("Using the medical evidence", ~lines 28-66, and "Validator rules", ~line 130)
- Test: `backend/tests/test_contracts.py`, `ai/tests/test_pipeline.py`, `ai/tests/test_evidence.py`

**Interfaces:**
- Produces: `load_source_topics() -> dict` with keys `conditions` (source_id → condition), `rare_only_conditions` (list) and `excerpts` (excerpt_id → list of lowercase terms). Also `find_source_topic_errors(output: AnalysisOutput, topics: dict) -> list[str]`.
- Consumes: the existing correction loop. Errors returned by `find_reference_errors` already reach `validation_errors_from_previous_attempt` (`ai/pipeline.py` ~145-169).

**Why a side file:** `Source` / `SourceExcerpt` are `extra="forbid"`. Adding fields would change the public schemas, `GET /sources` and the Supabase `sources.excerpts` jsonb, which forces a migration and a reseed.

- [ ] **Step 1: Create `backend/data/source_topics.json`.** Copy the term lists for all 23 excerpts from `proto.py` (beside the handoff), and ADD `"molecular"` to `exc-fabry-female-enzyme` (otherwise the fixture's `clm-no-molecular-test` is a false positive). Use `conditions`: genereviews-fabry → fabry, fabry-female-strategy → fabry, sfn-review → small_fiber_neuropathy, ada-diabetic-neuropathy → diabetes. Use `rare_only_conditions: ["fabry"]`.
- [ ] **Step 2: Write the failing tests:**
  - `test_topic_table_covers_every_registered_excerpt` (test_evidence.py): the registry's excerpt_ids equal the `excerpts` keys, and every source_id has a `conditions` entry.
  - `test_claim_cannot_cite_excerpt_about_another_finding` (test_contracts.py): take the fixture dict. Point one claim at `src-genereviews-fabry/exc-fabry-gi` with GERD text ("…gastroesophageal reflux disease.") and a verbatim record quote. Assert an error that names the claim id and `exc-fabry-gi`.
  - `test_common_hypothesis_cannot_rest_on_rare_only_source`: set `clm-sfn-often-idiopathic.source_refs` to `[{"source_id": "src-genereviews-fabry", "excerpt_id": "exc-fabry-sfn"}]`. Assert an error matching `"supports non-rare"`.
  - `test_unrelated_source_gets_one_correction` (test_pipeline.py, modelled on `test_competing_explanations_cannot_share_a_claim`): `_rejected_twice(sarah, test_sources, extraction, handoff, "cites src-")`.
- [ ] **Step 3: Run** those files. Expected: FAIL (no loader, no rule).
- [ ] **Step 4: Implement `find_source_topic_errors`:**
  - **Rule A:** for each claim, set `hay = lower(claim.text + " " + " ".join(r.excerpt for r in claim.record_refs))`. Each `source_ref` needs at least one of its excerpt's terms as a substring of `hay`. Error: `f"{claim_id}: cites {source_id}/{excerpt_id} but neither the claim nor its record quote mentions {sorted(terms)[:4]}; cite an excerpt about this finding, or drop the claim"`.
  - **Rule B:** for each hypothesis with `is_rare_disease == False`, a supporting claim whose source_refs ALL map to a rare-only condition is an error: `f"{claim_id}: supports non-rare {hypothesis_id} but cites only rare-disease source(s); cite evidence about {h.name!r}"`.
  - Call it at the end of `find_reference_errors` with `topics=load_source_topics()` as the default.
  - Prompt: add the paragraph "Before writing each source_ref, name the finding the claim is about and confirm the excerpt text mentions that same finding or condition … If no supplied excerpt covers the finding, omit the claim." Add validator rule 8: topic terms must appear, and a non-rare hypothesis cannot rest only on rare-disease sources.
- [ ] **Step 5: Run** the full suite. Expected: PASS. `test_fixture_references_resolve` must stay green; that is the false-positive guard.
- [ ] **Step 6: Commit** `fix(ai): claims may only cite excerpts about the same finding`

### Task 5 (B3): Possible outcomes stay conditional

**Files:**
- Modify: `ai/pipeline.py` (add a helper beside `_shared_support_errors`, ~line 242; extend the `check_output` errors line, ~179), `ai/prompts/handoff.md` (~lines 109-112 plus validator rule 9), `backend/app/config.py:58`, `backend/.env.example`, `ai/evaluation.md`
- Test: `ai/tests/test_pipeline.py`

**Interfaces:**
- Produces: `_outcome_wording_errors(output: AnalysisOutput) -> list[str]`, which scans only `missing_evidence[].possible_outcomes[].outcome + implication`.

- [ ] **Step 1: Write the failing tests:**
  - `test_outcome_wording_check`, parametrized:
    - Flagged (True): "would establish the diagnosis of Fabry disease in a female proband.", "would confirm the diagnosis", "would rule out Fabry disease", "is a definitive answer".
    - Not flagged (False): "would support the diagnosis of Fabry disease.", "would make Fabry disease less likely.", "would remain inconclusive regarding the diagnosis.", "Fabry disease becomes the leading question, pending clinician confirmation.", "Removes family history as supporting evidence."
  - `test_overconfident_possible_outcome_is_rejected`: `_rejected_twice(...)` with `missing_evidence[1].possible_outcomes[0].implication` set to the real Sarah phrase.
  - `test_overconfident_outcome_gets_one_correction`: `side_effect=[extraction, bad, handoff]`. The run succeeds, and the second handoff payload's `validation_errors_from_previous_attempt` mentions `possible_outcomes`.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest -q ai/tests/test_pipeline.py`. Expected: FAIL (import error).
- [ ] **Step 3: Implement.** The regex (copy exactly, since it is what the cases above pin):

```python
_OVERCONFIDENT = re.compile(
    r"\b(?:would|will|can|could)\s+(?:definitively\s+|conclusively\s+)?(?:establish|confirm|prove|diagnose|rule\s+out|exclude)\b"
    r"|\b(?:confirms?|confirmed|proves?|proven|definitive(?:ly)?|conclusive(?:ly)?|diagnostic\s+of)\b",
    re.IGNORECASE,
)
```

  The error text names the item and the phrase and suggests "would support" / "would remain inconclusive". Add `+ _outcome_wording_errors(output)` to the `check_output` errors.
  - Prompt (~109-112): replace the exemption "may say a result establishes or excludes a diagnosis only if a cited excerpt says…" with "Possible outcomes stay conditional and hedged: use only 'would support', 'would make … less likely', 'would remain inconclusive', or 'would prompt the clinician to consider'. Never write that a result would establish, confirm, prove, diagnose, rule out or exclude a diagnosis; the clinician makes the diagnosis. Include an inconclusive outcome where one is possible."
  - Bump `PROMPT_VERSION` to `extract-v3+handoff-v4`. This covers the Task 4 and Task 5 prompt changes.
  - Add one line to `ai/evaluation.md` "Remaining quality issues": outcome wording is now enforced.
- [ ] **Step 4: Run** the full suite. Expected: PASS. `test_backend_hook_returns_exact_shared_type` proves the fixture is not flagged.
- [ ] **Step 5: Commit** `fix(ai): possible outcomes may not claim to settle a diagnosis`

### Task 6 (B6): Document graph scope

**Files:**
- Modify: `contracts/README.md` (after the AnalysisRun example's closing fence, before "Provenance labels", ~line 192; also the "roughly 8–12 nodes" comment at ~186)
- Test: `backend/tests/test_contracts.py`

**Decision baked in:** option (a), document only. Adding a node for every finding would break `test_graph_stays_small`, change the frontend's pinned counts (Sarah 12 nodes / 13 edges), and collide with the frontend's own `context` nodes.

- [ ] **Step 1: Write the guard test** `test_graph_omits_unlinked_findings(fixture_output)`: the finding node ids equal the union of `supporting_finding_ids`, and the fixture has unlinked findings (`fnd-celiac-negative`, `fnd-diabetes-absent`, `fnd-enzyme-normal`). It passes immediately, because it pins existing behaviour; say so in the commit.
- [ ] **Step 2: Add the README paragraph:** "**Graph scope.** `graph.nodes` of type `finding` include only findings that support at least one hypothesis; every hypothesis, prior result and missing-evidence item is always a node. Unlinked findings are intentionally omitted to keep the graph small and connected, so a run can have far fewer graph nodes than `output.findings` (e.g. 12 findings, 6 nodes). They remain complete in `output.findings` and `timeline[].finding_ids`; a client that shows them draws them itself, using the finding's `finding_id`, without edges." Change "roughly 8–12 nodes" to "typically 6–12 nodes; hypothesis-linked findings only (see Graph scope)".
- [ ] **Step 3: Run** the full suite. Expected: PASS.
- [ ] **Step 4: Commit** `docs: graph nodes cover only hypothesis-linked findings`

## After all tasks

- Final gate: `.venv/bin/python -m pytest -q` passes with the baseline 120 plus the new tests. Then a final whole-branch review.
- Hand to the user before pushing:
  - The migration still has to be applied on hosted (Daniel).
  - The PROMPT_VERSION bump means fresh Gemini runs.
  - The health-screen frontend must regenerate its offline bundle (`cd frontend && node scripts/build-offline-fixtures.mjs`) after it merges `main`, to pick up Task 3.
