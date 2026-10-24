import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import patientJson from "@/fixtures/sarah-001.patient.json";
import type { PatientDocument, PatientRecord, PatientSummary } from "@/lib/contracts";
import { DISCLAIMER } from "@/lib/disclaimer";
import { type PatientRow, summaryRow, withDetails } from "@/lib/landing/rows";
import type { HealthState, UsePatients } from "@/lib/landing/usePatients";
import { LandingScreen } from "../LandingScreen";

const mockUsePatients = vi.fn<() => UsePatients>();
const mockHealth = vi.fn<() => HealthState>();
vi.mock("@/lib/landing/usePatients", () => ({ usePatients: () => mockUsePatients(), useBackendHealth: () => mockHealth() }));

const retry = vi.fn();
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
  record_id: `${specialty}-${date}`,
  date,
  type: "clinic_note",
  specialty,
  title: "t",
  author_role: null,
  text: "x",
  observations: [],
});

const rowWith = (documents: PatientDocument[], overrides: Partial<PatientSummary> = {}): PatientRow =>
  withDetails(summaryRow(summary(overrides), 2026), { ...sarah, documents });

const state = (patch: Partial<UsePatients>) => mockUsePatients.mockReturnValue({ phase: "ready", rows: [], error: null, retry, ...patch });
const show = () => render(<LandingScreen />);

beforeEach(() => {
  mockUsePatients.mockReset();
  mockHealth.mockReset();
  retry.mockReset();
  mockHealth.mockReturnValue("ready");
  state({});
});

describe("LandingScreen content", () => {
  it("renders the wordmark, headline, sub line, three steps and the disclaimer", () => {
    show();
    expect(screen.getByRole("banner")).toHaveTextContent("NextClue");
    expect(screen.getByRole("heading", { level: 1, name: "Scattered records, one handoff." })).toBeInTheDocument();
    expect(screen.getByText("Every finding links back to the record it came from. Open questions stay open until a clinician decides.")).toBeInTheDocument();
    const steps = within(screen.getByRole("region", { name: "How it works" })).getAllByRole("listitem");
    expect(steps.map((s) => within(s).getByRole("heading").textContent)).toEqual(["Gather", "Connect", "Hand off"]);
    expect(screen.getByText(`The clinician decides; nothing here is confirmed. *${DISCLAIMER}`)).toBeInTheDocument();
  });

  it("labels the illustration as such", () => {
    show();
    expect(screen.getByRole("img", { name: /^Illustration:/ })).toBeInTheDocument();
    expect(screen.getByText("Illustration")).toBeInTheDocument();
  });

  it("Choose a patient jumps to the patient list", () => {
    show();
    expect(screen.getByRole("link", { name: /Choose a patient/ })).toHaveAttribute("href", "#patients");
    expect(document.getElementById("patients")).toBe(screen.getByRole("region", { name: "Patients" }));
  });
});

describe("backend health indicator", () => {
  it.each<[HealthState, string | null]>([
    ["ready", "Backend ready"],
    ["unreachable", "Backend unreachable"],
    ["offline", "Offline sample"],
    ["checking", null],
  ])("%s", (health, text) => {
    mockHealth.mockReturnValue(health);
    show();
    const banner = screen.getByRole("banner");
    if (text) expect(banner).toHaveTextContent(text);
    else expect(banner).not.toHaveTextContent(/Backend|Offline/);
  });
});

describe("patient list", () => {
  it("each row is one link to the patient's health screen, with the count", () => {
    state({ rows: [rowWith([doc("neurology", "2012-05-10"), doc("neurology", "2024-01-12")])] });
    show();
    expect(screen.getByRole("link", { name: "Emma, 36, open graph" })).toHaveAttribute("href", "/patients/p-1");
    expect(screen.getByText("1 synthetic")).toBeInTheDocument();
    expect(screen.getByText("2 records")).toBeInTheDocument();
    expect(screen.getByText("2012–2024")).toBeInTheDocument();
  });

  it("shows name, age and sex, omitting sex when it is unknown", () => {
    state({ rows: [summaryRow(summary(), 2026), summaryRow(summary({ patient_id: "p-2", display_name: "Alex", sex_at_birth: "intersex" }), 2026)] });
    show();
    expect(screen.getByRole("link", { name: "Emma, 36, open graph" })).toHaveTextContent("Emma · 36 · F");
    expect(screen.getByRole("link", { name: "Alex, 36, open graph" })).toHaveTextContent(/^Alex · 36p-2/);
  });

  it("never renders the display-name suffix", () => {
    state({ rows: [summaryRow(summary({ display_name: "Emma (synthetic, negative control)" }), 2026)] });
    const { container } = show();
    expect(screen.getByRole("link", { name: "Emma, 36, open graph" })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/negative control/i);
  });

  it("shows at most two chips and collapses the rest into +k", () => {
    state({
      rows: [rowWith([doc("neurology"), doc("neurology"), doc("dermatology"), doc("nephrology"), doc("ophthalmology")])],
    });
    show();
    const link = screen.getByRole("link", { name: /Emma/ });
    expect(within(link).getByText("Neurology")).toBeInTheDocument();
    expect(within(link).getByText("Dermatology")).toBeInTheDocument();
    expect(within(link).queryByText("Nephrology")).not.toBeInTheDocument();
    expect(within(link).getByText("+2")).toBeInTheDocument();
  });

  it("omits +k when every specialty is shown", () => {
    state({ rows: [rowWith([doc("neurology")])] });
    show();
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });

  it("a row without details shows the name only", () => {
    state({ rows: [summaryRow(summary(), 2026)] });
    show();
    const link = screen.getByRole("link", { name: "Emma, 36, open graph" });
    expect(link).toHaveTextContent("Emma · 36 · Fp-1");
    expect(within(link).queryByText(/records?$/)).not.toBeInTheDocument();
  });

  it("loading shows the text and an indeterminate progress line", () => {
    state({ phase: "loading" });
    show();
    expect(screen.getByText("Loading patients…")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });

  it("unreachable alerts with the backend address and Retry calls retry", async () => {
    state({ phase: "unreachable", error: "Can't reach the backend at http://127.0.0.1:8000" });
    show();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/^Can't reach the backend at http/);
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("failed shows the server message with Retry in an alert", async () => {
    state({ phase: "failed", error: "Database unavailable" });
    show();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Database unavailable");
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("empty says so, without a count", () => {
    state({ rows: [] });
    show();
    expect(screen.getByText("No patients in the database.")).toBeInTheDocument();
    expect(screen.queryByText(/synthetic$/)).not.toBeInTheDocument();
  });
});
