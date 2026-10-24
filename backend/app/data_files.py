"""Synthetic data and fixtures stored as JSON files under backend/data/."""

from __future__ import annotations

import json

from .config import DATA_DIR
from .contracts import AnalysisOutput, PatientRecord, SourceRegistry


def load_patient_files() -> list[PatientRecord]:
    return [
        PatientRecord.model_validate_json(path.read_text(encoding="utf-8"))
        for path in sorted((DATA_DIR / "patients").glob("*.json"))
    ]


def load_source_registry() -> SourceRegistry:
    return SourceRegistry.model_validate_json((DATA_DIR / "sources.json").read_text(encoding="utf-8"))


def load_source_topics() -> dict:
    """Topic terms per excerpt, kept beside sources.json so the public Source schema stays unchanged."""
    return json.loads((DATA_DIR / "source_topics.json").read_text(encoding="utf-8"))


def load_fixture_output(patient_id: str) -> AnalysisOutput | None:
    path = DATA_DIR / "fixtures" / f"{patient_id}.analysis-output.json"
    if not path.exists():
        return None
    return AnalysisOutput.model_validate(json.loads(path.read_text(encoding="utf-8")))
