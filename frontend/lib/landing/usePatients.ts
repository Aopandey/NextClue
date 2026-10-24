import { useCallback, useEffect, useState } from "react";
import bundledPatient from "@/fixtures/sarah-001.patient.json";
import type { PatientRecord, PatientSummary } from "@/lib/contracts";
import { ApiError, ApiUnreachable, dataMode, getHealth, getPatient, listPatients } from "@/lib/api/client";
import { type PatientRow, summaryRow, withDetails } from "./rows";

export type PatientsPhase = "loading" | "ready" | "unreachable" | "failed";

export interface UsePatients {
  phase: PatientsPhase;
  rows: PatientRow[];
  error: string | null;
  retry: () => void;
}

interface State {
  key: number;
  phase: PatientsPhase;
  rows: PatientRow[];
  error: string | null;
}

const OFFLINE_PATIENT = bundledPatient as PatientRecord;

const initial = (key: number): State => ({ key, phase: "loading", rows: [], error: null });

function offlineSummary(): PatientSummary {
  const { patient_id, record_version, demographics } = OFFLINE_PATIENT;
  return { patient_id, current_version: record_version, ...demographics };
}

function failure(error: unknown): Pick<State, "phase" | "error"> {
  if (error instanceof ApiUnreachable) return { phase: "unreachable", error: error.message };
  if (error instanceof ApiError) return { phase: "failed", error: error.displayMessage };
  return { phase: "failed", error: error instanceof Error ? error.message : String(error) };
}

/**
 * Names appear as soon as the list loads; each row's records, span and chips fill in when its own
 * GET /patients/{id} resolves. A failed detail call leaves that row name-only.
 */
export function usePatients(): UsePatients {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>(() => initial(attempt));

  useEffect(() => {
    const controller = new AbortController();
    // State is tagged with its attempt, so a retry reads as "loading" at once; a stale response is dropped.
    const update = (apply: (prev: State) => State) => {
      if (controller.signal.aborted) return;
      setState((prev) => apply(prev.key === attempt ? prev : initial(attempt)));
    };

    void (async () => {
      const offline = dataMode() === "offline";
      try {
        const summaries = offline ? [offlineSummary()] : await listPatients(controller.signal);
        const year = new Date().getFullYear();
        update((prev) => ({ ...prev, phase: "ready", rows: summaries.map((s) => summaryRow(s, year)), error: null }));

        await Promise.allSettled(
          summaries.map(async (s) => {
            const record = offline ? OFFLINE_PATIENT : await getPatient(s.patient_id);
            update((prev) => ({ ...prev, rows: prev.rows.map((row) => (row.id === s.patient_id ? withDetails(row, record) : row)) }));
          }),
        );
      } catch (error) {
        update((prev) => ({ ...prev, ...failure(error) }));
      }
    })();

    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = state.key === attempt ? state : initial(attempt);
  return { phase: current.phase, rows: current.rows, error: current.error, retry };
}

export type HealthState = "ready" | "unreachable" | "offline" | "checking";

/** Offline mode makes no request; otherwise GET /health decides. */
export function useBackendHealth(): HealthState {
  const offline = dataMode() === "offline";
  const [state, setState] = useState<HealthState>("checking");

  useEffect(() => {
    if (offline) return;
    const controller = new AbortController();
    getHealth(controller.signal)
      .then((health): HealthState => (health.status === "ok" ? "ready" : "unreachable"))
      .catch((): HealthState => "unreachable")
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      });
    return () => controller.abort();
  }, [offline]);

  return offline ? "offline" : state;
}
