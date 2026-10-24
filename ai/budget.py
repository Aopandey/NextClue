"""One cancellation-aware deadline shared by all calls in an analysis."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
import math
from threading import Event
import time
from typing import TypeVar

T = TypeVar("T")


class AnalysisDeadlineExceeded(TimeoutError):
    pass


@dataclass
class RequestBudget:
    deadline: float
    cancelled: Event = field(default_factory=Event, repr=False)

    @classmethod
    def after(cls, seconds: float) -> RequestBudget:
        if not math.isfinite(seconds) or seconds <= 0:
            raise ValueError("Analysis timeout must be a positive, finite number.")
        return cls(time.monotonic() + seconds)

    def remaining(self, limit: float | None = None) -> float:
        remaining = self.deadline - time.monotonic()
        if self.cancelled.is_set() or remaining <= 0:
            raise AnalysisDeadlineExceeded("The analysis deadline was reached.") from None
        return remaining if limit is None else min(remaining, limit)

    def pause(self, seconds: float) -> None:
        if seconds >= self.remaining():
            raise AnalysisDeadlineExceeded("Not enough analysis time remains for another retry.") from None
        self.cancelled.wait(seconds)
        self.remaining()


_active: ContextVar[RequestBudget | None] = ContextVar("analysis_budget", default=None)


@contextmanager
def budget_scope(budget: RequestBudget):
    token = _active.set(budget)
    try:
        budget.remaining()
        yield budget
    finally:
        _active.reset(token)


def check_deadline() -> None:
    if (budget := _active.get()) is not None:
        budget.remaining()


def request_timeout(seconds: float) -> float:
    budget = _active.get()
    return seconds if budget is None else budget.remaining(seconds)


def run_request(operation: Callable[[], Awaitable[T]], seconds: float) -> T:
    """Bound the whole HTTP exchange, even when bytes keep arriving.

    Called from the synchronous pipeline worker/CLI. Async cancellation unwinds
    the HTTP client's context and releases its connection before returning.
    Socket inactivity timeouts alone do not bound a trickled response.
    """
    async def bounded() -> T:
        budget = _active.get()
        remaining = budget.remaining() if budget is not None else None
        analysis_limited = remaining is not None and remaining <= seconds
        timer = asyncio.timeout(min(seconds, remaining) if remaining is not None else seconds)
        try:
            async with timer:
                return await operation()
        except TimeoutError:
            # Event-loop timers can fire one clock tick early (notably on
            # Windows). Use the bound that expired, rather than checking a
            # second clock sample that could briefly allow evidence fallback.
            if timer.expired() and analysis_limited:
                raise AnalysisDeadlineExceeded("The analysis deadline was reached.") from None
            check_deadline()
            raise

    try:
        return asyncio.run(bounded())
    except TimeoutError:
        check_deadline()  # Preserve analysis timeout instead of evidence fallback.
        raise


def retry_pause(seconds: float) -> None:
    budget = _active.get()
    if budget is None:
        time.sleep(seconds)
    else:
        budget.pause(seconds)
