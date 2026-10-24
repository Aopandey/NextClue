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

const base: UseAnalysis = { phase: "completed", run, patient, sources, elapsedMs: 0, error: null, httpError: null, retry };
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

  it("completed run with no output draws nothing and says so, with the disclaimer and Retry", async () => {
    state({ run: { ...run, provenance: "live", output: null, graph: null, timeline: null } });
    show();
    expect(nodes()).toHaveLength(0);
    expect(screen.getByText("The analysis completed without output.")).toBeInTheDocument();
    expect(screen.getByText(`The clinician decides; nothing here is confirmed. *${run.disclaimer}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("HTTP 503 configuration_error: message and code, labelled a server configuration problem, no Retry", () => {
    state({
      phase: "failed",
      run: null,
      patient: null,
      error: "Server is missing GEMINI_API_KEY.",
      httpError: { status: 503, code: "configuration_error", retryable: false },
    });
    show();
    expect(screen.getByText("Server is missing GEMINI_API_KEY.")).toBeInTheDocument();
    expect(screen.getByText("configuration_error · HTTP 503")).toBeInTheDocument();
    expect(screen.getByText(/server configuration problem/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("a retryable HTTP error keeps Retry", () => {
    state({ phase: "failed", run: null, patient: null, error: "Backend returned 500: boom", httpError: { status: 500, code: null, retryable: true } });
    show();
    expect(screen.getByText("HTTP 500")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("the disclaimer is visible while loading, on failure and when unreachable", () => {
    for (const patch of [
      { phase: "loading" as const, run: null, patient: null },
      { phase: "unreachable" as const, run: null, patient: null, error: "Can't reach the backend at x" },
      { phase: "failed" as const, run: { ...pending, status: "failed" as const, error: { code: "timeout" as const, message: "Model timed out", retryable: true } }, error: "Model timed out" },
    ]) {
      state(patch);
      const { unmount } = show();
      expect(screen.getByText(`The clinician decides; nothing here is confirmed. *${run.disclaimer}`)).toBeInTheDocument();
      unmount();
    }
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

  it("replayed: also shows run.error's message and code; no Retry live when it is not retryable", () => {
    state({
      run: {
        ...run,
        provenance: "replayed",
        fallback_reason: "Live attempt failed; showing an earlier validated run.",
        error: { code: "model_error", message: "Provider returned 503 after retries", retryable: false },
      },
    });
    show();
    expect(screen.getByText(/showing an earlier validated run/)).toBeInTheDocument();
    expect(screen.getByText("Provider returned 503 after retries")).toBeInTheDocument();
    expect(screen.getByText("model_error")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry live" })).toBeNull();
    expect(nodes().length).toBeGreaterThan(0);
  });
});

describe("HealthScreen back link", () => {
  it.each([
    ["loading", { phase: "loading" as const, run: null, patient: null }],
    ["completed", {}],
  ])("links back to the patient list while %s", (_name, patch) => {
    state(patch);
    show();
    expect(screen.getByRole("link", { name: "← Patients" })).toHaveAttribute("href", "/");
  });
});

describe("HealthScreen completed", () => {
  it("fixture: header line and provenance tag", () => {
    state({ run: { ...run, evidence_mode: "live" } });
    show();
    expect(screen.getByText("Sarah · 40 · F · 10 records 2012–2024")).toBeInTheDocument();
    expect(screen.getByText("Sample data")).toBeInTheDocument();
    expect(screen.queryByText("Evidence: cached")).toBeNull();
  });

  it("live: model name; cached evidence is flagged", () => {
    state({ run: { ...run, provenance: "live", evidence_mode: "cached" } });
    show();
    expect(screen.getByText(`Live analysis · ${run.versions.model}`)).toBeInTheDocument();
    expect(screen.getByText("Evidence: cached")).toBeInTheDocument();
  });

  it("live evidence (PubMed-selected) is labelled too, distinct from cached", () => {
    state({ run: { ...run, provenance: "live", evidence_mode: "live" } });
    show();
    expect(screen.getByText("Evidence: live (PubMed)")).toBeInTheDocument();
    expect(screen.queryByText("Evidence: cached")).toBeNull();
  });

  it("age comes from the run's year, not a fixed year", () => {
    state({ run: { ...run, created_at: "2031-03-01T00:00:00Z" } });
    show();
    expect(screen.getByText("Sarah · 45 · F · 10 records 2012–2024")).toBeInTheDocument();
  });

  it("footer shows the clinician line and the disclaimer as one line", () => {
    state({});
    show();
    expect(screen.getByText(`The clinician decides; nothing here is confirmed. *${run.disclaimer}`)).toBeInTheDocument();
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
    expect(container.querySelector("svg.cn")!.getAttribute("viewBox")).toBe("0 0 400 780");
    fireEvent.click(nodes()[nodes().length - 1]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("screen-body")).toHaveStyle({ paddingBottom: "45vh" });
    vi.unstubAllGlobals();
  });

  it("follows the media query when it changes", () => {
    const change = narrowMatch(false);
    state({});
    const { container } = show();
    expect(container.querySelector("svg.cn")!.getAttribute("viewBox")).not.toBe("0 0 400 780");
    act(() => change(true));
    expect(container.querySelector("svg.cn")!.getAttribute("viewBox")).toBe("0 0 400 780");
    vi.unstubAllGlobals();
  });
});
