import { useCallback, useEffect, useState } from "react";
import bundledRun from "@/fixtures/sarah-001.run.json";
import bundledPatient from "@/fixtures/sarah-001.patient.json";
import bundledSources from "@/fixtures/sources.json";
import type { AnalysisRun, PatientRecord, Source } from "@/lib/contracts";
import {
  ApiError,
  ApiUnreachable,
  type DataMode,
  dataMode,
  getFixtureRun,
  getPatient,
  getSource,
  isPending,
  pollRun,
  startAnalysis,
} from "./client";

export type AnalysisPhase = "loading" | "queued" | "running" | "completed" | "failed" | "unreachable";

/** An HTTP error from the backend, kept apart from `run.error` (CLAUDE.md: handle them separately). */
export interface HttpError {
  status: number;
  /** `detail.code`, e.g. "configuration_error"; null for a plain string detail. */
  code: string | null;
  /** False when the backend marks the error as not retryable. */
  retryable: boolean;
}

export interface AnalysisState {
  phase: AnalysisPhase;
  run: AnalysisRun | null;
  patient: PatientRecord | null;
  sources: Record<string, Source>;
  elapsedMs: number;
  error: string | null;
  httpError: HttpError | null;
}

export interface UseAnalysis extends AnalysisState {
  /** Re-runs the whole load from scratch. */
  retry: () => void;
}

const INITIAL: AnalysisState = {
  phase: "loading",
  run: null,
  patient: null,
  sources: {},
  elapsedMs: 0,
  error: null,
  httpError: null,
};
const TICK_MS = 250;

// Offline mode: the bundle in frontend/fixtures/ (built by scripts/build-offline-fixtures.mjs), no backend.
const OFFLINE = {
  run: bundledRun as AnalysisRun,
  patient: bundledPatient as PatientRecord,
  sources: bundledSources as Record<string, Source>,
};

function offlineFor(patientId: string): typeof OFFLINE {
  if (patientId !== OFFLINE.patient.patient_id) {
    throw new Error(`No bundled sample for patient "${patientId}"; offline mode only has ${OFFLINE.patient.patient_id}.`);
  }
  return OFFLINE;
}

/** Source IDs cited by the run's claims, in first-citation order. */
function citedSourceIds(run: AnalysisRun): string[] {
  const ids = run.output?.claims.flatMap((claim) => claim.source_refs.map((ref) => ref.source_id)) ?? [];
  return [...new Set(ids)];
}

// Each POST /analyses may start a Gemini run, and the backend's reuse check is not atomic. A second mount for the
// same patient while a POST is in flight (StrictMode runs effects twice in dev) awaits that POST instead.
const startsInFlight = new Map<string, Promise<AnalysisRun>>();

function startOnce(patientId: string): Promise<AnalysisRun> {
  let started = startsInFlight.get(patientId);
  if (!started) {
    started = startAnalysis(patientId).finally(() => startsInFlight.delete(patientId));
    startsInFlight.set(patientId, started);
  }
  return started;
}

async function loadRun(
  mode: DataMode,
  patientId: string,
  onPending: (run: AnalysisRun) => void,
  signal: AbortSignal,
): Promise<AnalysisRun> {
  if (mode === "offline") return offlineFor(patientId).run;
  if (mode === "fixture") return getFixtureRun(patientId);
  // live: 202 is a new queued run; 200 is a reused run, which may itself still be in progress.
  const started = await startOnce(patientId);
  if (!isPending(started)) return started;
  onPending(started);
  return pollRun(started.run_id, {
    signal,
    onStatus: (run) => {
      if (isPending(run)) onPending(run);
    },
  });
}

async function loadPatient(mode: DataMode, patientId: string): Promise<PatientRecord> {
  return mode === "offline" ? offlineFor(patientId).patient : getPatient(patientId);
}

/** Sources that fail to load are left out; their citations then read "Source unavailable". */
async function loadSources(mode: DataMode, patientId: string, ids: string[]): Promise<Record<string, Source>> {
  const loaded = await Promise.allSettled(
    ids.map(async (id) => {
      if (mode !== "offline") return getSource(id);
      const source = offlineFor(patientId).sources[id];
      if (!source) throw new Error(`Source ${id} is not in the offline bundle.`);
      return source;
    }),
  );
  return Object.fromEntries(ids.flatMap((id, i) => {
    const result = loaded[i];
    return result.status === "fulfilled" ? [[id, result.value]] : [];
  }));
}

type Outcome = Pick<AnalysisState, "phase" | "error" | "httpError">;

function settled(run: AnalysisRun): Outcome {
  return run.status === "failed"
    ? { phase: "failed", error: run.error?.message ?? null, httpError: null }
    : { phase: "completed", error: null, httpError: null };
}

function failure(error: unknown): Outcome {
  if (error instanceof ApiUnreachable) return { phase: "unreachable", error: error.message, httpError: null };
  if (error instanceof ApiError) {
    return { phase: "failed", error: error.displayMessage, httpError: { status: error.status, code: error.code, retryable: error.retryable } };
  }
  return { phase: "failed", error: error instanceof Error ? error.message : String(error), httpError: null };
}

/**
 * Loads the analysis run per NEXT_PUBLIC_DATA_MODE, then the patient record, then every source the run's
 * claims cite. In live mode a queued/running run is polled, with `elapsedMs` ticking every 250 ms.
 */
export function useAnalysis(patientId: string): UseAnalysis {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${attempt}:${patientId}`;
  // State is tagged with the request it belongs to, so a new patient or a retry reads as INITIAL at once.
  const [state, setState] = useState(() => ({ ...INITIAL, key: requestKey }));

  useEffect(() => {
    const controller = new AbortController();
    const startedAt = Date.now();
    let ticker: ReturnType<typeof setInterval> | undefined;

    const update = (patch: Partial<AnalysisState>) => {
      if (controller.signal.aborted) return;
      setState((prev) => ({ ...(prev.key === requestKey ? prev : { ...INITIAL, key: requestKey }), ...patch }));
    };
    const stopTicker = () => {
      clearInterval(ticker);
      ticker = undefined;
    };
    const onPending = (run: AnalysisRun) => {
      if (controller.signal.aborted) return;
      ticker ??= setInterval(() => update({ elapsedMs: Date.now() - startedAt }), TICK_MS);
      update({ phase: run.status === "queued" ? "queued" : "running", run, elapsedMs: Date.now() - startedAt });
    };

    void (async () => {
      const mode = dataMode();
      let run: AnalysisRun | null = null;
      try {
        run = await loadRun(mode, patientId, onPending, controller.signal);
        stopTicker();
        const patient = await loadPatient(mode, patientId);
        const sources = await loadSources(mode, patientId, citedSourceIds(run));
        update({ run, patient, sources, ...settled(run) });
      } catch (error) {
        stopTicker();
        // A run that did load is kept, so a later patient error does not throw it away.
        update({ ...(run && { run }), ...failure(error) });
      }
    })();

    return () => {
      controller.abort();
      stopTicker();
    };
  }, [patientId, requestKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = state.key === requestKey ? state : INITIAL;
  return {
    phase: current.phase,
    run: current.run,
    patient: current.patient,
    sources: current.sources,
    elapsedMs: current.elapsedMs,
    error: current.error,
    httpError: current.httpError,
    retry,
  };
}
