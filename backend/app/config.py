"""Settings read from backend/.env (never committed). See .env.example."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"

load_dotenv(BACKEND_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str
    model: str
    prompt_version: str
    analysis_timeout_seconds: float
    cors_origins: list[str]


def get_settings() -> Settings:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY is not set. Copy backend/.env.example to backend/.env "
            "and fill it from `npx supabase status`."
        )
    return Settings(
        supabase_url=os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321"),
        supabase_service_key=key,
        model=os.environ.get("MODEL_NAME", "not-configured"),
        prompt_version=os.environ.get("PROMPT_VERSION", "extract-v1+synth-v1"),
        analysis_timeout_seconds=float(os.environ.get("ANALYSIS_TIMEOUT_SECONDS", "90")),
        cors_origins=[o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")],
    )
