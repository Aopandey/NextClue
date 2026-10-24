"""Settings read from backend/.env (never committed). See .env.example."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from pathlib import Path

from ai.configuration import ConfigurationError

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str = field(repr=False)
    model: str
    prompt_version: str
    analysis_timeout_seconds: float
    cors_origins: list[str]
    retrieval_mode: str


def get_cors_origins() -> list[str]:
    from ai.gemini_client import load_env_files

    load_env_files()
    return [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]


def get_settings() -> Settings:
    from ai.gemini_client import Settings as GeminiSettings
    from ai.retrieval import pubmed_timeout, retrieval_setting

    gemini = GeminiSettings.from_env(require_key=False)
    mode = retrieval_setting()
    if mode == "pubmed":
        pubmed_timeout()
    try:
        timeout = float(os.environ.get("ANALYSIS_TIMEOUT_SECONDS", "90"))
    except ValueError:
        raise ConfigurationError("ANALYSIS_TIMEOUT_SECONDS must be a finite positive number.") from None
    if not math.isfinite(timeout) or timeout <= 0:
        raise ConfigurationError("ANALYSIS_TIMEOUT_SECONDS must be a finite positive number.")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        raise ConfigurationError(
            "SUPABASE_SERVICE_ROLE_KEY is not set. Copy backend/.env.example to backend/.env "
            "and configure your Supabase project locally."
        )
    return Settings(
        supabase_url=os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321"),
        supabase_service_key=key,
        model=gemini.model,
        prompt_version=os.environ.get("PROMPT_VERSION", "extract-v3+handoff-v4"),
        analysis_timeout_seconds=timeout,
        cors_origins=get_cors_origins(),
        retrieval_mode=mode,
    )
