"""File-based AI check, independent of Docker/Supabase. Uses real model calls."""

from __future__ import annotations

import argparse
import json
import logging
import os
import time
from pathlib import Path
import sys

# Match the backend's documented `app.*` imports rather than loading a second
# copy as backend.app.* (which would create different Pydantic class identities).
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.contracts import PatientRecord  # noqa: E402
from app.data_files import load_patient_files, load_source_registry  # noqa: E402
from ai.pipeline import extract_findings, run_analysis  # noqa: E402
from ai.scenarios import SCENARIOS, build  # noqa: E402
from ai.budget import RequestBudget, budget_scope  # noqa: E402
from ai.gemini_client import load_env_files  # noqa: E402


def main() -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--patient", default="sarah-001")
    parser.add_argument("--scenario", choices=sorted(SCENARIOS),
                        help="Changed-input check from ai/evaluation.md (overrides --patient).")
    parser.add_argument("--extract-only", action="store_true", help="One call; no medical interpretation.")
    parser.add_argument("--exclude", action="append", default=[], metavar="RECORD_ID")
    args = parser.parse_args()
    try:
        patients = load_patient_files()
        if args.scenario:
            patient = build(args.scenario, patients)
        else:
            patient = next((p for p in patients if p.patient_id == args.patient), None)
        if patient is None:
            raise ValueError("Patient not found in backend/data/patients/.")
        unknown = set(args.exclude) - {d.record_id for d in patient.documents}
        if unknown:
            raise ValueError(f"Unknown excluded record IDs: {sorted(unknown)}")
        data = patient.model_dump(mode="json")
        data["documents"] = [d for d in data["documents"] if d["record_id"] not in args.exclude]
        patient = PatientRecord.model_validate(data)
        started = time.monotonic()
        load_env_files()
        budget = RequestBudget.after(float(os.getenv("ANALYSIS_TIMEOUT_SECONDS", "90")))
        with budget_scope(budget):
            if args.extract_only:
                output = {"findings": [f.model_dump(mode="json") for f in extract_findings(patient)]}
                suffix = "findings"
            else:
                registry = load_source_registry()
                result, selection = run_analysis(patient, registry.sources)
                output = result.model_dump(mode="json")
                suffix = "analysis"
                print(f"Evidence {registry.evidence_version}: mode={selection.mode}; "
                      f"{', '.join(s.source_id for s in selection.sources)}. {selection.note}")
            budget.remaining()
        name = patient.patient_id
        if args.scenario:
            name += f"-{args.scenario}"
        name += "".join(f"-without-{r}" for r in sorted(args.exclude))
        folder = Path(__file__).resolve().parent / "runs"
        folder.mkdir(exist_ok=True)
        target = folder / f"{name}.{suffix}.json"
        target.write_text(json.dumps(output, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Validated fresh Gemini {suffix} in {time.monotonic() - started:.0f}s; "
              f"wrote {target.relative_to(BACKEND_DIR.parent)}.")
        print("Local file check only: no database run, replay, or fixture was used.")
        return 0
    except Exception as exc:
        # SDK and PubMed failures are already sanitized by their adapters.
        print(f"AI check failed: {type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
