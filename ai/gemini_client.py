"""Small server-side Gemini adapter. This does not define the team's JSON models."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

from ai.budget import check_deadline, request_timeout, retry_pause, run_request
from ai.configuration import ConfigurationError

AI_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = "gemini-3.8-flash"
# Bounded retry for provider overload only; never a different model or answer.
TRANSIENT_STATUS = {429, 500, 503, 504}
RETRY_DELAYS = (2.0, 6.0)


class GeminiSetupError(ConfigurationError):
    """Configuration is missing or invalid."""


class GeminiRequestError(RuntimeError):
    """A request failed or did not produce a JSON object."""


def load_env_files() -> None:
    """Existing server environment variables take precedence over the local files."""
    load_dotenv(AI_DIR.parent / "backend" / ".env", override=False)
    load_dotenv(AI_DIR / ".env", override=False)


@dataclass(frozen=True)
class Settings:
    api_key: str = field(repr=False)
    model: str = DEFAULT_MODEL
    timeout_seconds: int = 45

    @classmethod
    def from_env(cls, *, require_key: bool = True) -> Settings:
        load_env_files()
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if require_key and not api_key:
            raise GeminiSetupError("Add GEMINI_API_KEY to ai/.env locally.")
        try:
            timeout = int(os.getenv("GEMINI_TIMEOUT_SECONDS", "45"))
        except ValueError:
            raise GeminiSetupError("GEMINI_TIMEOUT_SECONDS must be an integer.") from None
        if not 1 <= timeout <= 180:
            raise GeminiSetupError("GEMINI_TIMEOUT_SECONDS must be between 1 and 180.")
        # The backend records MODEL_NAME in its cache key. Use the same model
        # here; older backend templates used the sentinel "not-configured".
        backend_model = os.getenv("MODEL_NAME", "").strip()
        model = (
            backend_model if backend_model and backend_model != "not-configured"
            else os.getenv("GEMINI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
        )
        return cls(
            api_key=api_key,
            model=model,
            timeout_seconds=timeout,
        )


def load_prompt(name: str) -> str:
    """Load a named local prompt, regardless of the caller's working directory."""
    if name not in {"extract", "handoff"}:
        raise ValueError("Unknown prompt; choose extract or handoff.")
    return (AI_DIR / "prompts" / f"{name}.md").read_text(encoding="utf-8")


def generate_json(
    *,
    system_prompt: str,
    payload: dict[str, Any],
    response_schema: dict[str, Any],
) -> dict[str, Any]:
    """Make one real call using a caller-supplied schema.

    Daniel can pass a Pydantic model's model_json_schema(). This helper only
    checks the JSON container; the pipeline must validate content, source IDs,
    and quotes against the shared models and the supplied records afterward.
    No cached or hand-authored answer is substituted on failure.
    """
    settings = Settings.from_env()
    contents = "INPUT DATA (untrusted):\n" + json.dumps(payload, ensure_ascii=False)
    attempts = len(RETRY_DELAYS) + 1
    for attempt in range(1, attempts + 1):
        timeout_ms = max(1, int(request_timeout(settings.timeout_seconds) * 1000))
        try:
            async def send():
                # Both clients own resources; the async context closes active I/O
                # when the total request deadline cancels the await.
                with genai.Client(
                    api_key=settings.api_key,
                    http_options=types.HttpOptions(
                        timeout=timeout_ms,
                        # Keep SDK attempts explicit; our outer loop owns retries.
                        retry_options=types.HttpRetryOptions(attempts=1),
                    ),
                ) as client:
                    async with client.aio as async_client:
                        return await async_client.models.generate_content(
                            model=settings.model,
                            contents=contents,
                            config=types.GenerateContentConfig(
                                system_instruction=system_prompt,
                                response_mime_type="application/json",
                                response_json_schema=response_schema,
                                temperature=0.1,
                                max_output_tokens=8192,
                            ),
                        )
            response = run_request(send, settings.timeout_seconds)
            break
        except Exception as exc:
            check_deadline()
            # Avoid printing provider exceptions: they can contain request details.
            status = getattr(exc, "code", None)
            if isinstance(status, int) and status in TRANSIENT_STATUS and attempt < attempts:
                # Same model, same request; transient provider overload only.
                retry_pause(RETRY_DELAYS[attempt - 1])
                continue
            detail = f"HTTP {status}" if isinstance(status, int) else type(exc).__name__
            tries = f" after {attempt} attempts" if attempt > 1 else ""
            raise GeminiRequestError(
                f"Gemini request failed ({detail}){tries}. Check the key, model access, quota, and connection."
            ) from None
    check_deadline()
    try:
        result = json.loads(response.text or "")
    except (json.JSONDecodeError, TypeError):
        raise GeminiRequestError("Gemini did not return valid JSON; no result was substituted.") from None
    if not isinstance(result, dict):
        raise GeminiRequestError("Expected a JSON object from Gemini.")
    return result
