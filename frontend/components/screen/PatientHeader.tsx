import type { AnalysisRun, PatientRecord } from "@/lib/contracts";

const REFERENCE_YEAR = 2026;
const SEX: Record<PatientRecord["demographics"]["sex_at_birth"], string | null> = {
  female: "F",
  male: "M",
  intersex: null,
  unknown: null,
};

function provenanceTag(run: AnalysisRun): string {
  if (run.provenance === "fixture") return "Sample data · not AI output";
  if (run.provenance === "live") return `Live analysis · ${run.versions.model}`;
  return "Replayed run";
}

function recordYears(patient: PatientRecord): string {
  const years = patient.documents.map((d) => Number(d.date.slice(0, 4)));
  const [first, last] = [Math.min(...years), Math.max(...years)];
  return first === last ? `${first}` : `${first}–${last}`;
}

/** One line: name, age, sex, record count and span; then where the analysis came from. */
export function PatientHeader({ patient, run }: { patient: PatientRecord; run: AnalysisRun }) {
  const { display_name, sex_at_birth, birth_year } = patient.demographics;
  const name = display_name.replace(/\s*\([^)]*\)\s*$/, "");
  const count = patient.documents.length;
  const parts = [name, `${REFERENCE_YEAR - birth_year}`, SEX[sex_at_birth], `${count} ${count === 1 ? "record" : "records"}${count ? ` ${recordYears(patient)}` : ""}`];
  return (
    <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h1 className="text-[17px] font-bold">{parts.filter(Boolean).join(" · ")}</h1>
      <span className="font-mono text-[12px] text-[var(--sig)]">{provenanceTag(run)}</span>
      {run.evidence_mode === "cached" && <span className="font-mono text-[12px] text-[var(--mut)]">Evidence: cached</span>}
    </header>
  );
}
