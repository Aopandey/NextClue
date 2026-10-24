"""Load synthetic patients and sources from backend/data/ into Supabase.

Run from backend/:  python -m scripts.seed
Everything is validated against the contracts before anything is written.
"""

from __future__ import annotations

import sys

from app import db
from app.data_files import load_fixture_output, load_patient_files, load_source_registry
from app.validation import find_reference_errors


def main() -> int:
    patients = load_patient_files()
    registry = load_source_registry()

    failed = False
    for patient in patients:
        fixture = load_fixture_output(patient.patient_id)
        if fixture is not None:
            errors = find_reference_errors(fixture, patient, registry.sources)
            for e in errors:
                print(f"fixture {patient.patient_id}: {e}", file=sys.stderr)
            failed |= bool(errors)
    if failed:
        print("Aborting: fixtures do not match the data files.", file=sys.stderr)
        return 1

    db.replace_sources(registry)
    print(f"sources: {len(registry.sources)} ({registry.evidence_version})")
    for patient in patients:
        db.upsert_patient(patient)
        print(f"patient: {patient.patient_id} v{patient.record_version}, {len(patient.documents)} documents")
    return 0


if __name__ == "__main__":
    sys.exit(main())
