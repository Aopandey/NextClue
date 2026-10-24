import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import patientJson from "@/fixtures/sarah-001.patient.json";
import type { PatientRecord, PatientSummary } from "@/lib/contracts";
import { useBackendHealth, usePatients } from "../usePatients";

const sarah = patientJson as PatientRecord;
const fetchMock = vi.fn<typeof fetch>();

const reply = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

const summaries: PatientSummary[] = [
  { patient_id: "sarah-001", display_name: "Sarah (synthetic)", sex_at_birth: "female", birth_year: 1986, current_version: 1 },
  { patient_id: "emma-003", display_name: "Emma (synthetic, negative control)", sex_at_birth: "female", birth_year: 1990, current_version: 1 },
];

const paths = () => fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname);

/** GET /patients answers `list`; each /patients/{id} answers its entry (a Response, or a promise of one). */
function backend(list: () => Response, details: Record<string, () => Response | Promise<Response>>) {
  fetchMock.mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/patients") return list();
    const detail = details[path.replace("/patients/", "")];
    return detail ? detail() : reply({ detail: "not found" }, 404);
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_API_URL", undefined);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("usePatients", () => {
  it("in live mode shows names first, then fills each row's details in", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    let releaseSarah!: () => void;
    const sarahGate = new Promise<void>((resolve) => (releaseSarah = resolve));
    backend(() => reply(summaries), {
      "sarah-001": async () => {
        await sarahGate;
        return reply(sarah);
      },
      "emma-003": () => reply({ ...sarah, patient_id: "emma-003", documents: sarah.documents.slice(0, 2) }),
    });

    const { result } = renderHook(() => usePatients());

    expect(result.current.phase).toBe("loading");
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.rows.map((r) => r.name)).toEqual(["Sarah", "Emma"]);
    await waitFor(() => expect(result.current.rows[1].details?.count).toBe(2));
    expect(result.current.rows[0].details).toBeNull();

    releaseSarah();
    await waitFor(() => expect(result.current.rows[0].details?.count).toBe(10));
    expect(result.current.rows[0].details?.span).toBe("2012–2024");
    expect(paths()).toEqual(["/patients", "/patients/sarah-001", "/patients/emma-003"]);
  });

  it("a failed detail leaves details null for that row only, with no error", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    backend(() => reply(summaries), {
      "sarah-001": () => reply(sarah),
      "emma-003": () => reply({ detail: "boom" }, 500),
    });

    const { result } = renderHook(() => usePatients());

    await waitFor(() => expect(result.current.rows[0]?.details).not.toBeNull());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(result.current.rows[1].details).toBeNull();
    expect(result.current.phase).toBe("ready");
    expect(result.current.error).toBeNull();
  });

  it("fetch rejecting → unreachable with the backend url", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const { result } = renderHook(() => usePatients());

    await waitFor(() => expect(result.current.phase).toBe("unreachable"));
    expect(result.current.error).toContain("Can't reach the backend at http://127.0.0.1:8000");
    expect(result.current.rows).toEqual([]);
  });

  it("an HTTP error → failed with its display message", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    backend(() => reply({ detail: { code: "configuration_error", message: "Database is not configured.", retryable: false } }, 503), {});

    const { result } = renderHook(() => usePatients());

    await waitFor(() => expect(result.current.phase).toBe("failed"));
    expect(result.current.error).toBe("Database is not configured.");
  });

  it("retry() reloads from loading", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "fixture");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const { result } = renderHook(() => usePatients());
    await waitFor(() => expect(result.current.phase).toBe("unreachable"));

    backend(() => reply(summaries), { "sarah-001": () => reply(sarah), "emma-003": () => reply(sarah) });
    act(() => result.current.retry());

    expect(result.current.phase).toBe("loading");
    expect(result.current.error).toBeNull();
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.rows).toHaveLength(2);
    await waitFor(() => expect(result.current.rows.every((r) => r.details)).toBe(true));
  });

  it("does not double the rows under StrictMode", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    backend(() => reply(summaries), { "sarah-001": () => reply(sarah), "emma-003": () => reply(sarah) });

    const { result } = renderHook(() => usePatients(), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.rows.every((r) => r.details)).toBe(true));
    expect(result.current.rows.map((r) => r.id)).toEqual(["sarah-001", "emma-003"]);
  });

  it("in offline mode returns the bundled Sarah and makes no fetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "offline");

    const { result } = renderHook(() => usePatients());

    await waitFor(() => expect(result.current.rows[0]?.details).not.toBeNull());
    expect(result.current.phase).toBe("ready");
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ id: "sarah-001", name: "Sarah", sex: "F" });
    expect(result.current.rows[0].details?.count).toBe(10);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useBackendHealth", () => {
  it("ok → ready, after checking", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    fetchMock.mockResolvedValue(reply({ status: "ok", database: "ok", model: "m" }));

    const { result } = renderHook(() => useBackendHealth());

    expect(result.current).toBe("checking");
    await waitFor(() => expect(result.current).toBe("ready"));
  });

  it("a 503 degraded body → unreachable", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "live");
    fetchMock.mockResolvedValue(reply({ status: "degraded", database: "unreachable: x" }, 503));

    const { result } = renderHook(() => useBackendHealth());

    await waitFor(() => expect(result.current).toBe("unreachable"));
  });

  it("a network failure → unreachable", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "fixture");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const { result } = renderHook(() => useBackendHealth());

    await waitFor(() => expect(result.current).toBe("unreachable"));
  });

  it("offline → offline with no fetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_MODE", "offline");

    const { result } = renderHook(() => useBackendHealth());

    expect(result.current).toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
