"""Real SDK/HTTP transport against loopback only; dummy keys, no paid calls."""

from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time
from unittest.mock import patch

from google import genai
from google.genai import types
import pytest

from ai import pubmed
from ai.budget import AnalysisDeadlineExceeded, RequestBudget, budget_scope, run_request
from ai.gemini_client import GeminiRequestError, generate_json


@pytest.fixture
def server():
    stopped = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args):
            pass

        def do_POST(self):
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            self.respond()

        def do_GET(self):
            self.respond()

        def respond(self):
            self.server.calls += 1
            self.close_connection = True  # No second keepalive read after a cancelled response.
            mode = self.server.mode
            if mode == "503":
                body = json.dumps({"error": {"code": 503, "message": "Local overload.", "status": "UNAVAILABLE"}}).encode()
            elif self.command == "GET":
                body = b'{"esearchresult":{"idlist":[]}}'
            else:
                body = json.dumps({"candidates": [{"content": {
                    "role": "model", "parts": [{"text": "{}"}],
                }, "finishReason": "STOP"}]}).encode()
            try:
                if mode == "headers":
                    for byte in b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n":
                        self.wfile.write(bytes([byte]))
                        self.wfile.flush()
                        if stopped.wait(0.08):
                            return
                    return  # deliberately incomplete headers
                self.send_response(503 if mode == "503" else 200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Connection", "close")
                self.end_headers()
                if mode == "body":
                    for byte in body:
                        self.wfile.write(bytes([byte]))
                        self.wfile.flush()
                        if stopped.wait(0.08):
                            return
                elif mode == "stall":
                    stopped.wait(5)
                else:
                    self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                self.server.disconnected.set()

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    httpd.daemon_threads = True
    httpd.calls = 0
    httpd.mode = "503"
    httpd.disconnected = threading.Event()
    thread = threading.Thread(target=lambda: httpd.serve_forever(poll_interval=0.02), daemon=True)
    thread.start()
    try:
        yield httpd, f"http://127.0.0.1:{httpd.server_port}"
    finally:
        stopped.set()
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=1)


@pytest.fixture
def local_gemini(server, monkeypatch):
    httpd, url = server
    real_client = genai.Client
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-local-only")

    def client(**kwargs):
        options = kwargs["http_options"]
        options.base_url = url
        options.client_args = {"trust_env": False}
        options.async_client_args = {"trust_env": False}
        return real_client(**kwargs)

    monkeypatch.setattr("ai.gemini_client.genai.Client", client)
    return httpd


def request():
    return generate_json(system_prompt="Synthetic transport check.", payload={}, response_schema={"type": "object"})


def test_real_sdk_makes_one_http_attempt_when_attempts_is_one(server):
    httpd, url = server

    async def send():
        with genai.Client(api_key="dummy-local-only", http_options=types.HttpOptions(
            base_url=url, client_args={"trust_env": False}, async_client_args={"trust_env": False},
            retry_options=types.HttpRetryOptions(attempts=1),
        )) as client:
            async with client.aio as async_client:
                await async_client.models.generate_content(model="test-model", contents="Synthetic.")

    with pytest.raises(Exception) as raised:
        run_request(send, 5)
    assert getattr(raised.value, "code", None) == 503
    assert httpd.calls == 1


def test_real_sdk_outer_retries_are_bounded(local_gemini):
    with patch("ai.gemini_client.retry_pause") as pause:
        with pytest.raises(GeminiRequestError, match="HTTP 503.*after 3 attempts"):
            request()
    assert local_gemini.calls == 3
    assert [call.args[0] for call in pause.call_args_list] == [2.0, 6.0]


def test_real_sdk_success_returns_json(local_gemini):
    local_gemini.mode = "success"
    assert request() == {}
    assert local_gemini.calls == 1


def test_real_pubmed_success_returns_pmids(server, monkeypatch):
    httpd, url = server
    httpd.mode = "success"
    monkeypatch.setattr(pubmed, "EUTILS", url)
    assert pubmed.search("synthetic transport check") == []
    assert httpd.calls == 1


def test_gemini_request_timeout_also_bounds_calls_without_analysis_budget(local_gemini, monkeypatch):
    local_gemini.mode = "body"
    monkeypatch.setenv("GEMINI_TIMEOUT_SECONDS", "1")
    started = time.monotonic()
    with pytest.raises(GeminiRequestError, match="TimeoutError"):
        request()
    assert time.monotonic() - started < 2
    assert local_gemini.calls == 1 and local_gemini.disconnected.wait(0.8)


def test_pubmed_request_timeout_also_bounds_calls_without_analysis_budget(server, monkeypatch):
    httpd, url = server
    httpd.mode = "body"
    monkeypatch.setattr(pubmed, "EUTILS", url)
    monkeypatch.setattr(pubmed, "_last_request", 0)
    started = time.monotonic()
    with pytest.raises(pubmed.PubMedError, match="TimeoutError"):
        pubmed.search("synthetic transport check", timeout=1)
    assert time.monotonic() - started < 2
    assert httpd.calls == 1 and httpd.disconnected.wait(0.8)


@pytest.mark.parametrize("mode", ["stall", "headers", "body"])
def test_real_gemini_worker_exits_at_deadline(local_gemini, mode):
    local_gemini.mode = mode

    def worker():
        with budget_scope(RequestBudget.after(1.5)):
            return request()

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(worker)
        with pytest.raises(AnalysisDeadlineExceeded):
            future.result(timeout=2.5)
        assert future.done()  # the worker actually exited; not just the API timer
    assert time.monotonic() - started < 2.5
    assert local_gemini.calls == 1
    if mode != "stall":
        assert local_gemini.disconnected.wait(0.8)


@pytest.mark.parametrize("mode", ["stall", "headers", "body"])
def test_real_pubmed_worker_exits_at_deadline(server, monkeypatch, mode):
    httpd, url = server
    httpd.mode = mode
    monkeypatch.setattr(pubmed, "EUTILS", url)
    monkeypatch.setattr(pubmed, "_last_request", 0)

    def worker():
        with budget_scope(RequestBudget.after(1.5)):
            return pubmed.search("synthetic transport check")

    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(worker)
        with pytest.raises(AnalysisDeadlineExceeded):
            future.result(timeout=2.5)
        assert future.done()
    assert time.monotonic() - started < 2.5
    assert httpd.calls == 1
    if mode != "stall":
        assert httpd.disconnected.wait(0.8)
