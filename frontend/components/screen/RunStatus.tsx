import { apiBase } from "@/lib/api/client";
import type { UseAnalysis } from "@/lib/api/useAnalysis";

const BUTTON = "inline-flex min-h-10 items-center border border-[var(--line)] px-3.5 text-[14px] font-bold text-[var(--ink)] hover:border-[var(--ink)]";

const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

type Props = Pick<UseAnalysis, "phase" | "run" | "error" | "elapsedMs" | "retry"> & { patientId: string };

/** Everything that is not a finished, drawable run: loading, progress, failure, unreachable. */
export function RunStatus({ phase, run, error, elapsedMs, retry, patientId }: Props) {
  if (phase === "loading") return <p className="text-[14px] text-[var(--mut)]">Loading analysis…</p>;

  if (phase === "queued" || phase === "running") {
    return (
      <div>
        <p className="font-mono text-[13px] text-[var(--mut)]">{`Analysing ${patientId} · ${mmss(elapsedMs)}`}</p>
        <div role="progressbar" aria-label="Analysis in progress" className="run-progress mt-2 h-0.5 w-full overflow-hidden bg-[var(--line)]">
          <div className="run-progress-bar h-full w-1/3 bg-[var(--sig)]" />
        </div>
      </div>
    );
  }

  if (phase === "unreachable") {
    return (
      <div className="space-y-2">
        <p className="text-[14px] font-bold">{error ?? `Can't reach the backend at ${apiBase()}`}</p>
        <p className="text-[13.5px] text-[var(--mut)]">Set NEXT_PUBLIC_DATA_MODE=offline to use the bundled sample.</p>
        <button type="button" className={BUTTON} onClick={retry}>Retry</button>
      </div>
    );
  }

  if (phase === "failed") {
    const runError = run?.error;
    return (
      <div className="space-y-2" role="alert">
        <p className="text-[14px] font-bold">{runError?.message ?? error ?? "The analysis failed."}</p>
        {runError && <p className="font-mono text-[12px] text-[var(--mut)]">{runError.code}</p>}
        {(runError ? runError.retryable : true) && (
          <button type="button" className={BUTTON} onClick={retry}>Retry</button>
        )}
      </div>
    );
  }

  if (run?.provenance === "replayed") {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-l-[3px] border-[var(--sig)] pl-3">
        <p className="text-[13.5px]">{run.fallback_reason ?? "Showing a replayed run."}</p>
        <button type="button" className={BUTTON} onClick={retry}>Retry live</button>
      </div>
    );
  }
  return null;
}
