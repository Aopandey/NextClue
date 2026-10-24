import { describe, expect, it } from "vitest";
import fixtureJson from "@/fixtures/sarah-001.run.json";
import type { AnalysisRun, Finding } from "@/lib/contracts";
import { systemFor } from "../systems";

const run = fixtureJson as AnalysisRun;

const base: Finding = {
  finding_id: "fnd-base",
  label: "Base finding",
  kind: "symptom",
  assertion: "present",
  date: null,
  specialty: "primary care",
  record_refs: [],
  hpo_id: null,
};

describe("systemFor", () => {
  it("maps every Sarah finding", () => expect(run.output!.findings.map(systemFor)).toEqual(["nerve","sweat","gut","gut","nerve","blood","blood","kidney","family","eye"]));

  it("unknown live finding uses keywords then specialty then other", () => {
    expect(systemFor({ ...base, finding_id:"fnd-x", label:"Recurrent palpitations" })).toBe("heart");
    expect(systemFor({ ...base, finding_id:"fnd-y", label:"Fatigue", specialty:"nephrology" })).toBe("kidney");
    expect(systemFor({ ...base, finding_id:"fnd-z", label:"Fatigue", specialty:null })).toBe("other");
  });

  it("unknown family-history finding is family before any keyword", () =>
    expect(systemFor({ ...base, finding_id: "fnd-mother", kind: "family_history", label: "Mother with kidney disease" })).toBe("family"));

  it("never throws on prototype-like IDs or specialties and falls back to other", () => {
    expect(systemFor({ ...base, finding_id: "constructor", label: "Fatigue", specialty: "toString" })).toBe("other");
    expect(systemFor({ ...base, finding_id: "__proto__", label: "", specialty: "__proto__" })).toBe("other");
  });

  it("matches specialty case-insensitively", () =>
    expect(systemFor({ ...base, finding_id: "fnd-w", label: "Fatigue", specialty: " Cardiology " })).toBe("heart"));
});
