"""Write JSON Schema files for each contract to contracts/schema/.

Run from backend/:  python -m scripts.export_schemas
"""

from __future__ import annotations

import json

from app.config import BACKEND_DIR
from app.contracts import AnalysisOutput, AnalysisRequest, AnalysisRun, PatientRecord, Source

SCHEMAS = {
    "patient-record": PatientRecord,
    "analysis-request": AnalysisRequest,
    "analysis-output": AnalysisOutput,
    "analysis-run": AnalysisRun,
    "source": Source,
}


def main() -> None:
    out_dir = BACKEND_DIR.parent / "contracts" / "schema"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, model in SCHEMAS.items():
        path = out_dir / f"{name}.schema.json"
        path.write_text(json.dumps(model.model_json_schema(), indent=2) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(BACKEND_DIR.parent)}")


if __name__ == "__main__":
    main()
