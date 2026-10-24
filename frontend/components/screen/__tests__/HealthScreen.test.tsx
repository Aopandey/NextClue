import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import runJson from "@/fixtures/sarah-001.run.json";
import patientJson from "@/fixtures/sarah-001.patient.json";
import sourcesJson from "@/fixtures/sources.json";
import type { AnalysisRun, PatientRecord, Source } from "@/lib/contracts";
import type { UseAnalysis } from "@/lib/api/useAnalysis";
import { HealthScreen } from "../HealthScreen";

const mockUseAnalysis = vi.fn<(id: string) => UseAnalysis>();
vi.mock("@/lib/api/useAnalysis", () => ({ useAnalysis: (id: string) => mockUseAnalysis(id) }));

const run = runJson as AnalysisRun;
const patient = patientJson as PatientRecord;
const sources = sourcesJson as Record<string, Source>;
const retry = vi.fn();

const base: UseAnalysis = { phase: "completed", run, patient, sources, elapsedMs: 0, error: null, retry };
const state = (patch: Partial<UseAnalysis>) => mockUseAnalysis.mockReturnValue({ ...base, ...patch });
const pending = { ...run, status: "running" as const, output: null, graph: null, timeline: null };
const show = () => render(<HealthScreen patientId="sarah-001" />);
const nodes = () => document.querySelectorAll("[data-node-id]");

beforeEach(() => {
  mockUseAnalysis.mockReset();
  retry.mockReset();
});

describe("HealthScreen run states", () => {
  it("loading", () => {
    state({ phase: "loading", run: null, patient: null });
    show();
    expect(screen.getByText("Loading analysis…")).toBeInTheDocument();
    expect(nodes()).toHaveLength(0);
  });

  it("running shows the elapsed time and an indeterminate progress line", () => {
    state({ phase: "running", run: pending, patient: null, elapsedMs: 7000 });
    show();
    expect(screen.getByText("Analysing sarah-001 · 00:07")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    expect(nodes()).toHaveLength(0);
  });

  it("unreachable shows the url, Retry and the offline hint", async () => {
    state({ phase: "unreachable", run: null, patient: null, error: "Can't reach the backend at http://127.0.0.1:8000" });
    show();
    expect(screen.getByText("Can't reach the backend at http://127.0.0.1:8000")).toBeInTheDocument();
    expect(screen.getByText("Set NEXT_PUBLIC_DATA_MODE=offline to use the bundled sample.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("failed run: error message and code, Retry, no nodes", () => {
    const failed: AnalysisRun = {
      ...pending,
      status: "failed",
      error: { code: "timeout", message: "Model did not respond within 60 s.", retryable: true },
    };
    state({ phase: "failed", run: failed, patient, error: failed.error!.message });
    show();
    expect(screen.getByText(/Model did not respond/)).toBeInTheDocument();
    expect(screen.getByText("timeout")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(nodes()).toHaveLength(0);
  });

  it("failed run that is not retryable has no Retry", () => {
    const failed: AnalysisRun = { ...pending, status: "failed", error: { code: "not_found", message: "No such patient.", retryable: false } };
    state({ phase: "failed", run: failed, error: "No such patient." });
    show();
    expect(screen.getByText("No such patient.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("load error (no run.error): shows the error string with Retry", async () => {
    state({ phase: "failed", run: null, patient: null, error: "Source src-9 is not in the offline bundle." });
    show();
    expect(screen.getByText("Source src-9 is not in the offline bundle.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(nodes()).toHaveLength(0);
  });

  it("completed run with no output draws nothing", () => {
    state({ run: { ...run, output: null, graph: null } });
    show();
    expect(nodes()).toHaveLength(0);
  });

  it("replayed: shows the fallback reason and Retry live", async () => {
    state({ run: { ...run, provenance: "replayed", fallback_reason: "Live model timed out." } });
    show();
    expect(screen.getByText(/Live model timed out\./)).toBeInTheDocument();
    expect(screen.getByText("Replayed run")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry live" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(nodes().length).toBeGreaterThan(0);
  });
});

describe("HealthScreen completed", () => {
  it("fixture: header line and provenance tag", () => {
    state({ run: { ...run, evidence_mode: "live" } });
    show();
    expect(screen.getByText("Sarah · 40 · F · 10 records 2012–2024")).toBeInTheDocument();
    expect(screen.getByText("Sample data · not AI output")).toBeInTheDocument();
    expect(screen.queryByText("Evidence: cached")).toBeNull();
  });

  it("live: model name; cached evidence is flagged", () => {
    state({ run: { ...run, provenance: "live", evidence_mode: "cached" } });
    show();
    expect(screen.getByText(`Live analysis · ${run.versions.model}`)).toBeInTheDocument();
    expect(screen.getByText("Evidence: cached")).toBeInTheDocument();
  });

  it("footer shows the disclaimer and the clinician line", () => {
    state({});
    show();
    expect(screen.getByText(run.disclaimer)).toBeInTheDocument();
    expect(screen.getByText("The clinician decides; nothing here is confirmed.")).toBeInTheDocument();
  });

  it("no open questions: calm message, no hubs", () => {
    const none = {
      ...run,
      output: { ...run.output!, hypotheses: run.output!.hypotheses.map((h) => ({ ...h, status: "excluded" as const })) },
    };
    state({ run: none });
    show();
    expect(screen.getByText("No open questions in this run")).toBeInTheDocument();
    expect(screen.queryAllByTestId("hub")).toHaveLength(0);
  });

  it("clicking a node opens the panel; Escape closes it", async () => {
    state({});
    show();
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(nodes()[nodes().length - 1]);
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByRole("button", { name: "Close" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("complementary")).toBeNull();
  });
});

describe("HealthScreen narrow", () => {
  function narrowMatch(matches: boolean) {
    const listeners = new Set<() => void>();
    const mql = {
      matches,
      media: "(max-width: 639px)",
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    };
    vi.stubGlobal("matchMedia", () => mql);
    return (next: boolean) => {
      mql.matches = next;
      listeners.forEach((l) => l());
    };
  }

  it("uses the bottom sheet and reserves 45vh of page clearance while it is open", () => {
    narrowMatch(true);
    state({});
    const { container } = show();
    expect(container.querySelector("svg.cn")!.getAttribute("viewBox")).toBe("0 0 400 720");
    fireEvent.click(nodes()[nodes().length - 1]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("screen-body")).toHaveStyle({ paddingBottom: "45vh" });
    vi.unstubAllGlobals();
  });

  it("follows the media query when it changes", () => {
    const change = narrowMatch(false);
    state({});
    const { container } = show();
    expect(container.querySelector("svg.cn")!.getAttribute("viewBox")).not.toBe("0 0 400 720");
    act(() => change(true));
    expect(container.querySelector("svg.cn")!.getAttribute("viewBox")).toBe("0 0 400 720");
    vi.unstubAllGlobals();
  });
});
