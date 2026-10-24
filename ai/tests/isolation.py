"""Early-loaded pytest plugin: isolate both suites before collection imports settings.

Never load developer .env files or make outbound connections. Transport tests
may use loopback servers and dummy credentials.
"""

import ipaddress
import socket

import dotenv
import pytest

CONFIG_NAMES = (
    "GEMINI_API_KEY", "GEMINI_MODEL", "MODEL_NAME", "GEMINI_TIMEOUT_SECONDS",
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANALYSIS_TIMEOUT_SECONDS",
    "EVIDENCE_RETRIEVAL", "PROMPT_VERSION", "CORS_ORIGINS", "PUBMED_TIMEOUT_SECONDS",
    "NCBI_API_KEY", "NCBI_EMAIL", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI",
)
DEFAULTS = {
    "SUPABASE_SERVICE_ROLE_KEY": "test-only-not-a-key",
    "SUPABASE_URL": "http://127.0.0.1:54321",
}
_collection_env = pytest.MonkeyPatch()
for _name in CONFIG_NAMES:
    _collection_env.delenv(_name, raising=False)
for _name, _value in DEFAULTS.items():
    _collection_env.setenv(_name, _value)
_collection_env.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: False)

_getaddrinfo = socket.getaddrinfo
_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex


def _allow_loopback(host):
    if isinstance(host, bytes):
        host = host.decode("ascii")
    if host == "localhost":
        return
    try:
        if ipaddress.ip_address(host).is_loopback:
            return
    except ValueError:
        pass
    raise AssertionError("Tests must not use outbound network connections.")


def _local_dns(host, *args, **kwargs):
    _allow_loopback(host)
    return _getaddrinfo(host, *args, **kwargs)


def _local_connect(sock, address):
    _allow_loopback(address[0])
    return _connect(sock, address)


def _local_connect_ex(sock, address):
    _allow_loopback(address[0])
    return _connect_ex(sock, address)


_collection_env.setattr(socket, "getaddrinfo", _local_dns)
_collection_env.setattr(socket.socket, "connect", _local_connect)
_collection_env.setattr(socket.socket, "connect_ex", _local_connect_ex)


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch):
    for name in CONFIG_NAMES:
        monkeypatch.delenv(name, raising=False)
    for name, value in DEFAULTS.items():
        monkeypatch.setenv(name, value)


def pytest_unconfigure(config):
    _collection_env.undo()
