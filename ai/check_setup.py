"""Run from the repo root: python -m ai.check_setup [--ping]."""

from __future__ import annotations

import argparse

from ai.configuration import ConfigurationError
from ai.gemini_client import (
    AI_DIR,
    GeminiRequestError,
    GeminiSetupError,
    Settings,
    generate_json,
    load_prompt,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the AI starter without exposing your key.")
    parser.add_argument("--ping", action="store_true", help="Make one real Gemini connection check.")
    args = parser.parse_args()
    try:
        settings = Settings.from_env(require_key=args.ping)
        for name in ("extract", "handoff"):
            if not load_prompt(name).strip():
                raise GeminiSetupError(f"The {name} prompt is empty.")
        for relative in ("examples/sarah-notes.md", "evidence/starting-sources.md"):
            if not (AI_DIR / relative).is_file():
                raise GeminiSetupError(f"Missing ai/{relative}.")
        from ai.run import load_patient_files, load_source_registry
        from ai.evidence_tool import offline_problems
        from ai.retrieval import retrieval_setting
        patients = load_patient_files()
        registry = load_source_registry()
        verified = sum(s.verification_status == "verified" for s in registry.sources)
        print("OK: Gemini SDK, prompts, and starter files are ready.")
        print(f"Canonical data: {len(patients)} patients; {verified}/{len(registry.sources)} verified sources "
              f"({registry.evidence_version}).")
        for problem in offline_problems(registry):
            print(f"Registry problem: {problem}")
        print(f"Evidence retrieval: {retrieval_setting()} (EVIDENCE_RETRIEVAL).")
        if not verified:
            print("Full synthesis needs reviewed sources; extraction can be tested separately.")
        print(f"Model: {settings.model}")
        print("API key: configured" if settings.api_key else "API key: add it to ai/.env locally.")
        if not args.ping:
            print("Offline check passed. No Gemini request was made.")
            return 0
        result = generate_json(
            system_prompt="Return a JSON object whose status is NEXTCLUE_OK. This is a connection check.",
            payload={"message": "Connection check only; no patient records."},
            response_schema={
                "type": "object",
                "properties": {"status": {"type": "string", "enum": ["NEXTCLUE_OK"]}},
                "required": ["status"],
                "additionalProperties": False,
            },
        )
        if result.get("status") != "NEXTCLUE_OK":
            raise GeminiRequestError("The connection check returned an unexpected response.")
        print("OK: live Gemini connection verified. This ping does not evaluate the clinical pipeline.")
        return 0
    except (ConfigurationError, GeminiRequestError) as exc:
        print(f"Setup check: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
