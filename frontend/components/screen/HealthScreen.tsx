"use client";

import Link from "next/link";
import { useState } from "react";
import { ConstellationView } from "@/components/constellation/ConstellationView";
import { DetailPanel } from "@/components/detail/DetailPanel";
import { useAnalysis } from "@/lib/api/useAnalysis";
import { DISCLAIMER } from "@/lib/disclaimer";
import { PatientHeader } from "./PatientHeader";
import { RunStatus } from "./RunStatus";
import { useNarrow } from "./useNarrow";

/** The patient health screen: header, run state, constellation, and the detail panel for the selected node. */
export function HealthScreen({ patientId }: { patientId: string }) {
  const { phase, run, patient, sources, elapsedMs, error, httpError, retry } = useAnalysis(patientId);
  const narrow = useNarrow();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const drawable = phase === "completed" && run?.output && patient ? { run, patient } : null;
  const panelOpen = drawable !== null && selectedId !== null;

  return (
    <div className="flex min-h-dvh items-start">
      <div
        data-testid="screen-body"
        className="min-w-0 flex-1 px-4 py-4 sm:flex sm:h-dvh sm:flex-col sm:px-8"
        style={narrow && panelOpen ? { paddingBottom: "45vh" } : undefined}
      >
        <Link
          href="/"
          className="inline-flex min-h-11 items-center self-start text-[13px] text-[var(--mut)] hover:text-[var(--ink)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)] sm:min-h-8"
        >
          ← Patients
        </Link>
        <div className="space-y-3">
          {drawable && <PatientHeader patient={drawable.patient} run={drawable.run} />}
          <RunStatus phase={phase} run={run} error={error} httpError={httpError} elapsedMs={elapsedMs} retry={retry} patientId={patientId} />
        </div>
        {drawable && (
          <main className="mt-3 sm:min-h-[240px] sm:flex-1">
            <ConstellationView run={drawable.run} selectedId={selectedId} onSelect={setSelectedId} narrow={narrow} />
          </main>
        )}
        <footer className="mt-4 space-y-1 text-[12.5px] text-[var(--mut)]">
          <p>{run?.disclaimer || DISCLAIMER}</p>
          <p>The clinician decides; nothing here is confirmed.</p>
        </footer>
      </div>
      {drawable && selectedId && (
        <DetailPanel
          run={drawable.run}
          patient={drawable.patient}
          sources={sources}
          nodeId={selectedId}
          onClose={() => setSelectedId(null)}
          onSelect={setSelectedId}
          narrow={narrow}
        />
      )}
    </div>
  );
}
