import { describe, expect, it } from "vitest";
import patientJson from "@/fixtures/sarah-001.patient.json";
import type { PatientDocument, PatientRecord, PatientSummary } from "@/lib/contracts";
import { summaryRow, withDetails } from "../rows";

const sarah = patientJson as PatientRecord;

const summary = (overrides: Partial<PatientSummary> = {}): PatientSummary => ({
  patient_id: "p-1",
  display_name: "Emma",
  sex_at_birth: "female",
  birth_year: 1990,
  current_version: 1,
  ...overrides,
});

const doc = (specialty: string, date = "2020-01-01"): PatientDocument => ({
  record_id: `${specialty}-${date}-${Math.random()}`,
  date,
  type: "clinic_note",
  specialty,
  title: "t",
  author_role: null,
  text: "x",
  observations: [],
});

const withDocs = (documents: PatientDocument[]) => withDetails(summaryRow(summary(), 2026), { ...sarah, documents });

describe("summaryRow", () => {
  it("strips the display-name suffix and computes age from the given year", () => {
    const row = summaryRow(summary({ display_name: "Emma (synthetic, negative control)", birth_year: 1990 }), 2026);
    expect(row).toEqual({ id: "p-1", name: "Emma", age: 36, sex: "F", details: null });
  });

  it("maps sex_at_birth to a letter, and intersex/unknown to null", () => {
    expect(summaryRow(summary({ sex_at_birth: "male" }), 2026).sex).toBe("M");
    expect(summaryRow(summary({ sex_at_birth: "intersex" }), 2026).sex).toBeNull();
    expect(summaryRow(summary({ sex_at_birth: "unknown" }), 2026).sex).toBeNull();
  });
});

describe("withDetails", () => {
  it("counts documents and gives a year range", () => {
    const row = withDocs([doc("neurology", "2012-05-10"), doc("neurology", "2024-01-12"), doc("neurology", "2016-02-03")]);
    expect(row.details).toMatchObject({ count: 3, span: "2012–2024" });
  });

  it("gives a single year when all documents share one", () => {
    expect(withDocs([doc("neurology", "2019-01-01"), doc("neurology", "2019-12-31")]).details?.span).toBe("2019");
  });

  it("keeps the identity fields of the row it extends", () => {
    const base = summaryRow(summary(), 2026);
    expect(withDetails(base, sarah)).toMatchObject({ id: "p-1", name: "Emma", age: 36, sex: "F" });
  });

  it("caps chips at 2, ordered by document count then name, and counts the rest in `more`", () => {
    const row = withDocs([
      doc("neurology"),
      doc("neurology"),
      doc("nephrology"),
      doc("cardiology"),
      doc("dermatology"),
      doc("primary care"),
    ]);
    expect(row.details?.chips).toEqual([
      { specialty: "Neurology", system: "nerve" },
      { specialty: "Cardiology", system: "heart" },
    ]);
    // nephrology, dermatology, primary care
    expect(row.details?.more).toBe(3);
  });

  it("treats specialties case-insensitively and capitalises the chip label", () => {
    const row = withDocs([doc("Neurology"), doc("neurology "), doc("NEUROLOGY"), doc("cardiology")]);
    expect(row.details?.chips).toEqual([
      { specialty: "Neurology", system: "nerve" },
      { specialty: "Cardiology", system: "heart" },
    ]);
    expect(row.details?.more).toBe(0);
  });

  it("gives no chips when every specialty is unmapped, and counts them in `more`", () => {
    const row = withDocs([doc("primary care"), doc("genetics"), doc("Primary Care")]);
    expect(row.details?.chips).toEqual([]);
    expect(row.details?.more).toBe(2);
  });

  it("handles a record with no documents", () => {
    expect(withDocs([]).details).toEqual({ count: 0, span: "", chips: [], more: 0 });
  });

  it("summarises the bundled Sarah record", () => {
    const row = withDetails(summaryRow(summary({ patient_id: "sarah-001" }), 2026), sarah);
    expect(row.details).toEqual({
      count: 10,
      span: "2012–2024",
      chips: [
        { specialty: "Neurology", system: "nerve" },
        { specialty: "Cardiology", system: "heart" },
      ],
      more: 5,
    });
  });
});
