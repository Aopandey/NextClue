import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtureJson from "@/fixtures/sarah-001.run.json";
import type { AnalysisRun } from "@/lib/contracts";
import { ApiUnreachable, getFixtureRun, getPatient, pollRun, startAnalysis } from "../client";

const run = fixtureJson as AnalysisRun;
const fetchMock = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const liveRun = (status: AnalysisRun["status"]): AnalysisRun => ({
  ...run,
  run_id: "run-1",
  provenance: "live",
  status,
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("api client", () => {
  it("pollRun returns when status leaves queued/running and reports each status", async () => {
    fetchMock
      .mockResolvedValueOnce(json(liveRun("queued")))
      .mockResolvedValueOnce(json(liveRun("running")))
      .mockResolvedValueOnce(json(liveRun("completed")));
    const statuses: string[] = [];

    const final = await pollRun("run-1", { intervalMs: 1, onStatus: (r) => statuses.push(r.status) });

    expect(statuses).toEqual(["queued", "running", "completed"]);
    expect(final.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://127.0.0.1:8000/analyses/run-1");
  });

  it("pollRun rejects after timeoutMs", async () => {
    fetchMock.mockImplementation(async () => json(liveRun("running")));

    await expect(pollRun("run-1", { intervalMs: 5, timeoutMs: 20 })).rejects.toThrow(/timed out/);
  });

  it("network failure raises ApiUnreachable with the base url", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(getFixtureRun("sarah-001")).rejects.toMatchObject({
      name: "ApiUnreachable",
      url: "http://127.0.0.1:8000",
    });
    await expect(getFixtureRun("sarah-001")).rejects.toBeInstanceOf(ApiUnreachable);
    await expect(getFixtureRun("sarah-001")).rejects.toThrow("Can't reach the backend at http://127.0.0.1:8000");
  });

  it("reads NEXT_PUBLIC_API_URL at call time", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://backend.test:9000/");
    fetchMock.mockResolvedValue(json(run));

    await getFixtureRun("sarah-001");

    expect(String(fetchMock.mock.calls[0][0])).toBe("http://backend.test:9000/fixtures/analyses/sarah-001");
  });

  it("non-2xx raises an Error carrying the status and the backend detail", async () => {
    fetchMock.mockResolvedValue(json({ detail: "patient 'nobody' not found" }, 404));

    await expect(getPatient("nobody")).rejects.toMatchObject({
      status: 404,
      detail: "patient 'nobody' not found",
      message: expect.stringMatching(/404.*patient 'nobody' not found/),
    });
  });

  it("startAnalysis POSTs the patient id as JSON", async () => {
    fetchMock.mockResolvedValue(json(liveRun("queued"), 202));

    const started = await startAnalysis("sarah-001");

    expect(started.status).toBe("queued");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8000/analyses");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ patient_id: "sarah-001" });
  });

  it("fixture JSON has 10 timeline events, 12 nodes, 13 edges, 2 open hypotheses", () => {
    expect(run.timeline).toHaveLength(10);
    expect(run.graph!.nodes).toHaveLength(12);
    expect(run.graph!.edges).toHaveLength(13);
    expect(run.output!.hypotheses.filter((h) => h.status === "open")).toHaveLength(2);
  });
});
