"""Simulated clocks/providers: deadline checks make no external requests."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

import pytest

from ai.budget import AnalysisDeadlineExceeded, RequestBudget, budget_scope, request_timeout, run_request
from ai.gemini_client import generate_json
from ai import pubmed
from ai.tests.provider_mocks import gemini_client


def request():
    return generate_json(system_prompt="Transport test", payload={}, response_schema={"type": "object"})


def test_sdk_timeout_uses_remaining_budget_and_disables_hidden_retries(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    with patch("ai.budget.time.monotonic", return_value=100), \
         patch("ai.gemini_client.genai.Client") as factory:
        gemini_client(factory).models.generate_content.return_value = SimpleNamespace(text="{}")
        with budget_scope(RequestBudget.after(0.5)):
            assert request() == {}
    options = factory.call_args.kwargs["http_options"]
    assert options.timeout == 500 and options.retry_options.attempts == 1


def test_retry_cannot_outlive_total_budget(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    overloaded = RuntimeError("Provider overload")
    overloaded.code = 503
    with patch("ai.budget.time.monotonic", return_value=100), \
         patch("ai.gemini_client.genai.Client") as factory:
        client = gemini_client(factory)
        client.models.generate_content.side_effect = overloaded
        with budget_scope(RequestBudget.after(1)):
            with pytest.raises(AnalysisDeadlineExceeded, match="another retry"):
                request()
    assert client.models.generate_content.call_count == 1


def test_late_response_is_rejected_and_no_followup_request_starts(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    clock = [100.0]
    def late_response(**_kwargs):
        clock[0] += 3
        return SimpleNamespace(text="{}")
    with patch("ai.budget.time.monotonic", side_effect=lambda: clock[0]), \
         patch("ai.gemini_client.genai.Client") as factory:
        client = gemini_client(factory)
        client.models.generate_content.side_effect = late_response
        with budget_scope(RequestBudget.after(2)):
            with pytest.raises(AnalysisDeadlineExceeded):
                request()
            with pytest.raises(AnalysisDeadlineExceeded):
                request()
    assert client.models.generate_content.call_count == 1


def test_cancelled_worker_cannot_start_request(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    with patch("ai.gemini_client.genai.Client") as factory:
        with budget_scope(RequestBudget.after(5)) as budget:
            budget.cancelled.set()
            with pytest.raises(AnalysisDeadlineExceeded):
                request()
    factory.assert_not_called()


def test_pubmed_uses_same_remaining_budget():
    with patch("ai.budget.time.monotonic", return_value=100), \
         patch("ai.pubmed._last_request", 0), \
         patch("ai.pubmed.httpx.AsyncClient") as factory:
        get = factory.return_value.__aenter__.return_value.get = AsyncMock(return_value=httpx.Response(
            200, json={"esearchresult": {"idlist": []}}, request=httpx.Request("GET", "http://localhost/"),
        ))
        with budget_scope(RequestBudget.after(0.5)):
            assert pubmed.search("synthetic transport query") == []
    assert factory.call_args.kwargs["timeout"] == 0.5
    get.assert_awaited_once()


def test_pipeline_worker_installs_and_restores_shared_budget():
    from app.analyses import _run_with_budget

    with patch("ai.budget.time.monotonic", return_value=100):
        budget = RequestBudget.after(2)
        with patch("app.analyses.run_pipeline", side_effect=lambda *_: request_timeout(45)):
            assert _run_with_budget(None, [], budget) == 2
    assert request_timeout(45) == 45


@pytest.mark.parametrize("seconds", [0, -1, float("nan"), float("inf")])
def test_invalid_total_timeout_is_rejected(seconds):
    with pytest.raises(ValueError):
        RequestBudget.after(seconds)


@pytest.mark.parametrize("total, request_limit, expected", [
    (1, 45, AnalysisDeadlineExceeded), (45, 1, TimeoutError),
])
def test_timer_expiry_keeps_its_kind_when_clock_is_fractionally_early(total, request_limit, expected):
    async def timed_out():
        raise TimeoutError("Timer fired one tick early.")

    with patch("ai.budget.time.monotonic", return_value=100), \
         patch("ai.budget.asyncio.timeout") as timer:
        timer.return_value.expired.return_value = True
        timer.return_value.__aexit__.return_value = False
        with budget_scope(RequestBudget.after(total)):
            with pytest.raises(expected) as raised:
                run_request(timed_out, request_limit)
    # Both types inherit TimeoutError, so assert the exact classification.
    assert type(raised.value) is expected
