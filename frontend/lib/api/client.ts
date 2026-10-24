import type { AnalysisRequest, AnalysisRun, PatientRecord, PatientSummary, Source } from "@/lib/contracts";

export type DataMode = "fixture" | "live" | "offline";

const DEFAULT_API_URL = "http://127.0.0.1:8000";

// Env is read at call time, not at module load, so tests (vi.stubEnv) and each render see the current value.
// The literal `process.env.NEXT_PUBLIC_*` form lets Next.js inline the value into the client bundle.

/** Backend base URL from NEXT_PUBLIC_API_URL, without a trailing slash. */
export function apiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  return (configured || DEFAULT_API_URL).replace(/\/+$/, "");
}

/** NEXT_PUBLIC_DATA_MODE; anything other than "live" or "offline" means "fixture". */
export function dataMode(): DataMode {
  const mode = process.env.NEXT_PUBLIC_DATA_MODE;
  return mode === "live" || mode === "offline" ? mode : "fixture";
}

/** The request never reached the backend (fetch raised a network TypeError). */
export class ApiUnreachable extends Error {
  readonly url: string;

  constructor(url: string, options?: ErrorOptions) {
    super(`Can't reach the backend at ${url}`, options);
    this.name = "ApiUnreachable";
    this.url = url;
  }
}

/**
 * The backend answered with a non-2xx status; `detail` is FastAPI's `detail` (string or object).
 * An object detail such as `{code: "configuration_error", message, retryable: false}` exposes its fields.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly detail: unknown;
  readonly code: string | null;
  /** False only when the backend says so (`detail.retryable === false`). */
  readonly retryable: boolean;
  /** The object detail's own message; otherwise the full message with the status. */
  readonly displayMessage: string;

  constructor(status: number, detail: unknown) {
    super(`Backend returned ${status}: ${describeDetail(detail)}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    const fields = detail && typeof detail === "object" ? (detail as Record<string, unknown>) : {};
    this.code = typeof fields.code === "string" ? fields.code : null;
    this.retryable = fields.retryable !== false;
    this.displayMessage = typeof fields.message === "string" ? fields.message : this.message;
  }
}

function describeDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
    return detail.message;
  }
  return JSON.stringify(detail);
}

async function readDetail(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
    return body && typeof body === "object" && "detail" in body ? body.detail : body;
  } catch {
    return text || `HTTP ${response.status}`;
  }
}

async function request<T>(
  path: string,
  options: { body?: unknown; signal?: AbortSignal; acceptStatus?: number } = {},
): Promise<T> {
  const base = apiBase();
  const init: RequestInit =
    options.body === undefined
      ? { headers: { Accept: "application/json" }, signal: options.signal }
      : {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
          signal: options.signal,
        };
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, init);
  } catch (error) {
    if (error instanceof TypeError) throw new ApiUnreachable(base, { cause: error });
    throw error;
  }
  if (!response.ok && response.status !== options.acceptStatus) throw new ApiError(response.status, await readDetail(response));
  return (await response.json()) as T;
}

const segment = encodeURIComponent;

export function listPatients(signal?: AbortSignal): Promise<PatientSummary[]> {
  return request<PatientSummary[]>("/patients", { signal });
}

export interface Health {
  status: string;
  database: string;
  model?: string;
}

/** GET /health. A 503 means degraded, so it resolves with the body instead of throwing. */
export async function getHealth(signal?: AbortSignal): Promise<Health> {
  return request<Health>("/health", { signal, acceptStatus: 503 });
}

export function getPatient(id: string): Promise<PatientRecord> {
  return request<PatientRecord>(`/patients/${segment(id)}`);
}

export function getSource(id: string): Promise<Source> {
  return request<Source>(`/sources/${segment(id)}`);
}

/** Hand-authored sample run (provenance "fixture"). */
export function getFixtureRun(id: string): Promise<AnalysisRun> {
  return request<AnalysisRun>(`/fixtures/analyses/${segment(id)}`);
}

/** POST /analyses: 202 with a queued run, or 200 with a reused run (finished or still in progress). */
export function startAnalysis(patientId: string): Promise<AnalysisRun> {
  const body: AnalysisRequest = { patient_id: patientId, excluded_record_ids: [], force_refresh: false };
  return request<AnalysisRun>("/analyses", { body });
}

export function getRun(runId: string, signal?: AbortSignal): Promise<AnalysisRun> {
  return request<AnalysisRun>(`/analyses/${segment(runId)}`, { signal });
}

export function isPending(run: AnalysisRun): boolean {
  return run.status === "queued" || run.status === "running";
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Called with every fetched run, including the final one. */
  onStatus?: (run: AnalysisRun) => void;
  /** Aborting stops polling: the pending wait and any in-flight request are cancelled. */
  signal?: AbortSignal;
}

/** Polls GET /analyses/{run_id} until the run leaves queued/running, or rejects after timeoutMs. */
export async function pollRun(runId: string, opts: PollOptions = {}): Promise<AnalysisRun> {
  const { intervalMs = 1500, timeoutMs = 120_000, onStatus, signal } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    signal?.throwIfAborted();
    const run = await getRun(runId, signal);
    signal?.throwIfAborted();
    onStatus?.(run);
    if (!isPending(run)) return run;
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Analysis ${runId} timed out after ${timeoutMs / 1000} s`);
    await sleep(Math.min(intervalMs, remaining), signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
