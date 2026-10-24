import Link from "next/link";
import { apiBase } from "@/lib/api/client";
import type { PatientRow } from "@/lib/landing/rows";
import type { UsePatients } from "@/lib/landing/usePatients";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)]";
const BUTTON = `inline-flex min-h-11 items-center border border-[var(--line)] px-3.5 text-[14px] font-bold text-[var(--ink)] hover:border-[var(--ink)] sm:min-h-10 ${FOCUS}`;
const COLUMN = "font-mono text-[10px] uppercase tracking-[.07em] text-[var(--mut)]";

function Chips({ details }: { details: NonNullable<PatientRow["details"]> }) {
  return (
    <span className="col-start-1 row-start-3 flex flex-wrap items-center gap-1.5 sm:col-start-3 sm:row-start-1">
      {details.chips.map((chip) => (
        <span
          key={chip.specialty}
          className="inline-flex h-6 items-center gap-1.5 rounded-full pr-[9px] pl-[7px] text-[12.5px] text-[var(--ink)]"
          style={{ background: `color-mix(in srgb, var(--${chip.system}) 11%, transparent)` }}
        >
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: `var(--${chip.system})` }} />
          {chip.specialty}
        </span>
      ))}
      {details.more > 0 && <span className="font-mono text-[11px] text-[var(--faint)]">{`+${details.more}`}</span>}
    </span>
  );
}

function Row({ row }: { row: PatientRow }) {
  const { details } = row;
  return (
    <li className="border-t border-[var(--line)]">
      <Link
        href={`/patients/${row.id}`}
        aria-label={`${row.name}, ${row.age}, open graph`}
        className={`group grid min-h-[72px] grid-cols-[minmax(0,1fr)_20px] items-center gap-x-2.5 gap-y-1 px-1 py-3 hover:bg-[rgba(212,82,12,.045)] sm:min-h-16 sm:grid-cols-[230px_170px_minmax(0,1fr)_130px] sm:gap-x-4 sm:px-3 sm:py-2.5 focus-visible:outline-offset-[-2px] ${FOCUS}`}
      >
        <span className="col-start-1 min-w-0">
          <span className="text-[16px] font-bold">
            {row.name}{" "}
            <span className="font-normal text-[var(--mut)]">{`· ${row.age}${row.sex ? ` · ${row.sex}` : ""}`}</span>
          </span>
          <span className="mt-px block font-mono text-[11px] text-[var(--faint)]">{row.id}</span>
        </span>
        {details && (
          <>
            <span className="col-start-1 row-start-2 text-[13.5px] sm:col-start-2 sm:row-start-1">
              {`${details.count} ${details.count === 1 ? "record" : "records"}`}
              {details.span && <span className="ml-1.5 font-mono text-[11.5px] text-[var(--mut)] sm:ml-0 sm:block">{details.span}</span>}
            </span>
            <Chips details={details} />
          </>
        )}
        <span
          aria-hidden="true"
          className="col-start-2 row-span-3 row-start-1 self-center sm:col-start-4 sm:row-span-1 sm:justify-self-end"
        >
          <span className="text-[24px] text-[var(--mut)] sm:hidden">›</span>
          <span className="hidden whitespace-nowrap text-[13px] font-bold text-[var(--sig)] group-hover:underline group-hover:underline-offset-[3px] sm:inline">Open →</span>
        </span>
      </Link>
    </li>
  );
}

function Body({ phase, rows, error, retry }: UsePatients) {
  if (phase === "loading") {
    return (
      <div>
        <p className="text-[14px] text-[var(--mut)]">Loading patients…</p>
        <div role="progressbar" aria-label="Loading patients" className="run-progress mt-2 h-0.5 w-full overflow-hidden bg-[var(--line)]">
          <div className="run-progress-bar h-full w-1/3 bg-[var(--sig)]" />
        </div>
      </div>
    );
  }

  if (phase === "unreachable" || phase === "failed") {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-[14px] font-bold">{phase === "unreachable" ? `Can't reach the backend at ${apiBase()}` : (error ?? "Could not load patients.")}</p>
        <button type="button" className={BUTTON} onClick={retry}>Retry</button>
      </div>
    );
  }

  if (rows.length === 0) return <p className="text-[14px] text-[var(--mut)]">No patients in the database.</p>;

  return (
    <>
      <div aria-hidden="true" className={`hidden grid-cols-[230px_170px_minmax(0,1fr)_130px] gap-x-4 px-3 pb-1.5 sm:grid ${COLUMN}`}>
        <span>Patient</span>
        <span>Records</span>
        <span>Specialties</span>
        <span />
      </div>
      <ul className="m-0 list-none border-b border-[var(--line)] p-0">
        {rows.map((row) => <Row key={row.id} row={row} />)}
      </ul>
    </>
  );
}

export function PatientList(props: UsePatients) {
  const showCount = props.phase === "ready" && props.rows.length > 0;
  return (
    <section id="patients" aria-labelledby="patients-heading" className="pt-7 pb-3 sm:pt-11">
      <div className="mb-3.5 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <h2 id="patients-heading" className="text-[22px] font-bold">Patients</h2>
        {showCount && <span className="font-mono text-[12px] text-[var(--mut)]">{`${props.rows.length} synthetic`}</span>}
      </div>
      <Body {...props} />
    </section>
  );
}
