"use client";

import { Icon, type IconName } from "@/components/constellation/icons";
import { DISCLAIMER } from "@/lib/disclaimer";
import { useBackendHealth, usePatients, type HealthState } from "@/lib/landing/usePatients";
import { HeroArt } from "./HeroArt";
import { PatientList } from "./PatientList";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)]";
const COLUMN = "mx-auto w-full max-w-[1120px] px-4 sm:px-8";

const HEALTH: Record<HealthState, { text: string; dot: string | null } | null> = {
  ready: { text: "Backend ready", dot: "var(--family)" },
  unreachable: { text: "Backend unreachable", dot: "var(--heart)" },
  offline: { text: "Offline sample", dot: null },
  checking: null,
};

// The link icon is not in the constellation set, so it is drawn here.
const LinkGlyph = () => (
  <>
    <circle cx="6" cy="17" r="2.6" />
    <circle cx="18" cy="17" r="2.6" />
    <circle cx="12" cy="6" r="2.6" />
    <path d="M10.6 8.2 7.4 14.8M13.4 8.2l3.2 6.6M8.6 17h6.8" />
  </>
);

function Glyph({ name, color, size }: { name: IconName | "link"; color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {name === "link" ? (
        <g fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <LinkGlyph />
        </g>
      ) : (
        <g transform="translate(12 12)">
          <Icon name={name} size={24} color={color} />
        </g>
      )}
    </svg>
  );
}

const STEPS: { title: string; line: string; icon: IconName | "link"; disc: string | null }[] = [
  { title: "Gather", line: "Notes, labs, imaging and referrals from every specialty.", icon: "doc", disc: "var(--eye)" },
  { title: "Connect", line: "Findings grouped by body system, each tied to its source line.", icon: "link", disc: "var(--sweat)" },
  { title: "Hand off", line: "Open questions and missing tests for the next specialist.", icon: "ask", disc: null },
];

function HowItWorks() {
  return (
    <section aria-label="How it works" className="border-y border-[var(--line)]">
      <ol className="m-0 grid list-none grid-cols-1 p-0 sm:grid-cols-3">
        {STEPS.map((step) => (
          <li
            key={step.title}
            className="grid grid-cols-[40px_minmax(0,1fr)] items-start gap-3.5 py-4 sm:pt-[22px] sm:pr-6 sm:pb-6 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[var(--line)] sm:[&:not(:first-child)]:border-t-0 sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:pl-6"
          >
            <span
              aria-hidden="true"
              className={`grid size-10 place-items-center rounded-full ${step.disc ? "" : "border-2 border-dashed border-[var(--sig)]"}`}
              style={step.disc ? { background: step.disc } : undefined}
            >
              <Glyph name={step.icon} color={step.disc ? "#fff" : "var(--sig)"} size={22} />
            </span>
            <div>
              <h3 className="mb-1 text-[15px] font-bold">{step.title}</h3>
              <p className="text-[13.5px] leading-normal text-[var(--mut)]">{step.line}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The landing page: what NextClue does, then the patients to open. */
export function LandingScreen() {
  const patients = usePatients();
  const health = HEALTH[useBackendHealth()];

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-8 sm:py-4">
        <p className="text-[19px] font-bold tracking-[-0.035em] sm:text-[21px]">
          Next<span className="text-[var(--sig)]">Clue</span>
        </p>
        <div className="flex items-center gap-4 font-mono text-[12px] text-[var(--mut)]">
          <span className="hidden sm:inline">Synthetic data</span>
          {health && (
            <span className="inline-flex items-center gap-1.5">
              {health.dot && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: health.dot }} />}
              {health.text}
            </span>
          )}
        </div>
      </header>

      <main className={COLUMN}>
        <section className="grid grid-cols-1 items-center gap-2 pt-7 pb-7 sm:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)] sm:gap-10 sm:pt-[52px] sm:pb-11">
          <div>
            <p className="font-mono text-[11.5px] uppercase tracking-[.08em] text-[var(--sig)]">Neurology → genetics</p>
            <h1 className="mt-2.5 mb-3 font-[family-name:var(--font-serif)] text-[32px] leading-[1.08] font-semibold tracking-[-0.01em] sm:mt-3.5 sm:mb-4 sm:text-[46px]">
              Scattered records, one handoff.
            </h1>
            <p className="mb-[18px] max-w-[520px] text-[17px] leading-[1.55] text-[var(--mut)] sm:mb-6">
              Every finding links back to the record it came from. Open questions stay open until a clinician decides.
            </p>
            <a
              href="#patients"
              className={`inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--primary)] px-4 text-[14px] font-medium text-[var(--primary-foreground)] hover:bg-[#3a3a3a] sm:h-10 ${FOCUS}`}
            >
              Choose a patient
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M6 13l6 6 6-6" />
              </svg>
            </a>
          </div>
          <HeroArt />
        </section>

        <HowItWorks />
        <PatientList {...patients} />
      </main>

      <footer className={`${COLUMN} space-y-1 pt-4 pb-7 text-[12.5px] text-[var(--mut)] sm:pt-5`}>
        <p>{DISCLAIMER}</p>
        <p>The clinician decides; nothing here is confirmed.</p>
      </footer>
    </div>
  );
}
