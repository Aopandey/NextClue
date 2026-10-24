import type { PatientRecord, PatientSummary } from "@/lib/contracts";
import { type BodySystem, systemForText } from "@/lib/constellation/systems";

export interface PatientRow {
  id: string;
  name: string;
  age: number;
  sex: "F" | "M" | null;
  details: {
    count: number;
    span: string;
    chips: { specialty: string; system: BodySystem }[];
    more: number;
  } | null;
}

const MAX_CHIPS = 2;

// Same suffix rule as the patient header: "Emma (synthetic, negative control)" reads as "Emma".
const stripSuffix = (displayName: string) => displayName.replace(/\s*\([^)]*\)\s*$/, "");

const SEX_LETTER: Partial<Record<PatientSummary["sex_at_birth"], "F" | "M">> = { female: "F", male: "M" };

export function summaryRow(s: PatientSummary, year: number): PatientRow {
  return {
    id: s.patient_id,
    name: stripSuffix(s.display_name),
    age: year - s.birth_year,
    sex: SEX_LETTER[s.sex_at_birth] ?? null,
    details: null,
  };
}

function spanOf(dates: string[]): string {
  const years = dates.map((d) => Number(d.slice(0, 4))).filter(Number.isFinite);
  if (years.length === 0) return "";
  const first = Math.min(...years);
  const last = Math.max(...years);
  return first === last ? String(first) : `${first}–${last}`;
}

export function withDetails(row: PatientRow, record: PatientRecord): PatientRow {
  const bySpecialty = new Map<string, { label: string; count: number }>();
  for (const doc of record.documents) {
    const label = doc.specialty.trim();
    const entry = bySpecialty.get(label.toLowerCase());
    if (entry) entry.count += 1;
    else bySpecialty.set(label.toLowerCase(), { label, count: 1 });
  }

  const ranked = [...bySpecialty.entries()].sort(([nameA, a], [nameB, b]) => b.count - a.count || nameA.localeCompare(nameB));
  const chips = ranked
    .map(([, { label }]) => ({ specialty: label.charAt(0).toUpperCase() + label.slice(1), system: systemForText("", label) }))
    .filter((chip) => chip.system !== "other")
    .slice(0, MAX_CHIPS);

  return {
    ...row,
    details: {
      count: record.documents.length,
      span: spanOf(record.documents.map((d) => d.date)),
      chips,
      more: ranked.length - chips.length,
    },
  };
}
