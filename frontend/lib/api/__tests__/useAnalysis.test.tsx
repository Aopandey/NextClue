import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtureRunJson from "@/fixtures/sarah-001.run.json";
import patientJson from "@/fixtures/sarah-001.patient.json";
import sourcesJson from "@/fixtures/sources.json";
import type { AnalysisRun, PatientRecord, Source } from "@/lib/contracts";
import { useAnalysis } from "../useAnalysis";

const fixtureRun = fixtureRunJson as AnalysisRun;
const patient = patientJson as PatientRecord;
const sources = sourcesJson as Record<string, Source>;
const fetchMock = vi.fn<typeof fetch>();

const reply = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

/** Answers GETs for the patient and its sources; everything else comes from `routes`. */
function backend(routes: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const route = routes[`${init?.method ?? "GET"} ${path}`];
    if (route) return route();
    if (path === "/patients/sarah-001") return reply(patient);
    const sourceId = path.match(/^\/sources\/(.+)$/)?.[1];
    if (sourceId && sources[sourceId]) return reply(sources[sourceId]);
    return reply({ detail: `no route for ${path}` }, 404);
  });
}

const liveRun = (status: AnalysisRun["status"]): AnalysisRun => ({
  ...fixtureRun,
  run_id: "run-1",
  provenance: "live",
  status,
  ...(status === "completed" ? {} : { output: null, timeline: null, graph: null, completed_at: null }),
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("useAnalysis", () => {
  it("in offline mode goes loading → completed with the bundled fixture run and its sources", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "offline");

    const { result } = renderHook(() => useAnalysis("sarah-001"));

    expect(result.current.phase).toBe("loading");
    await waitFor(() => expect(result.current.phase).toBe("completed"));
    expect(result.current.run?.provenance).toBe("fixture");
    expect(result.current.patient?.patient_id).toBe("sarah-001");
    expect(Object.keys(result.current.sources)).toEqual(["src-genereviews-fabry", "src-sfn-review"]);
    expect(result.current.error).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("in fixture mode with fetch rejecting → unreachable with the backend url", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "fixture");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const { result } = renderHook(() => useAnalysis("sarah-001"));

    await waitFor(() => expect(result.current.phase).toBe("unreachable"));
    expect(result.current.error).toContain("Can't reach the backend at http://127.0.0.1:8000");
    expect(result.current.run).toBeNull();
  });

  it("in fixture mode loads the run, then the patient, then every cited source", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "fixture");
    backend({ "GET /fixtures/analyses/sarah-001": () => reply(fixtureRun) });

    const { result } = renderHook(() => useAnalysis("sarah-001"));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/fixtures/analyses/sarah-001",
      "/patients/sarah-001",
      "/sources/src-genereviews-fabry",
      "/sources/src-sfn-review",
    ]);
    expect(result.current.run?.run_id).toBe("fixture-sarah-001");
    expect(Object.keys(result.current.sources)).toEqual(["src-genereviews-fabry", "src-sfn-review"]);
  });

  it("a failed run → phase failed with the run's error message", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "fixture");
    const failed: AnalysisRun = {
      ...liveRun("failed"),
      error: { code: "timeout", message: "The AI pipeline did not finish in time.", retryable: true },
    };
    backend({ "GET /fixtures/analyses/sarah-001": () => reply(failed) });

    const { result } = renderHook(() => useAnalysis("sarah-001"));

    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(result.current.error).toBe("The AI pipeline did not finish in time.");
    expect(result.current.run?.error?.code).toBe("timeout");
    expect(result.current.patient?.patient_id).toBe("sarah-001");
    expect(result.current.sources).toEqual({});
  });

  it("retry() re-runs the load from scratch", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "fixture");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { result } = renderHook(() => useAnalysis("sarah-001"));
    await waitFor(() => expect(result.current.phase).toBe("unreachable"));

    backend({ "GET /fixtures/analyses/sarah-001": () => reply(fixtureRun) });
    act(() => result.current.retry());

    expect(result.current.phase).toBe("loading");
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.phase).toBe("completed"));
    expect(result.current.run?.provenance).toBe("fixture");
  });

  it("in live mode a 202 run is polled: queued → running → completed, with elapsedMs ticking until settle", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    const polls = [liveRun("queued"), liveRun("running"), liveRun("completed")];
    backend({
      "POST /analyses": () => reply(liveRun("queued"), 202),
      "GET /analyses/run-1": () => reply(polls.shift()),
    });

    const { result } = renderHook(() => useAnalysis("sarah-001"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.phase).toBe("queued");
    expect(result.current.run?.run_id).toBe("run-1");

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.phase).toBe("running");
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(1250);

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.phase).toBe("completed");
    expect(result.current.run?.provenance).toBe("live");
    expect(Object.keys(result.current.sources)).toEqual(["src-genereviews-fabry", "src-sfn-review"]);
    const settled = result.current.elapsedMs;

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(result.current.elapsedMs).toBe(settled);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("in live mode a 200 reused run is shown without polling", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    backend({ "POST /analyses": () => reply(liveRun("completed")) });

    const { result } = renderHook(() => useAnalysis("sarah-001"));

    await waitFor(() => expect(result.current.phase).toBe("completed"));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/analyses/run-1"))).toBe(false);
  });

  it("unmounting while polling clears the ticker and stops polling", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    backend({
      "POST /analyses": () => reply(liveRun("queued"), 202),
      "GET /analyses/run-1": () => reply(liveRun("running")),
    });
    const { result, unmount } = renderHook(() => useAnalysis("sarah-001"));
    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(result.current.phase).toBe("running");

    unmount();
    const callsAtUnmount = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock.mock.calls.length).toBe(callsAtUnmount);
  });
});
