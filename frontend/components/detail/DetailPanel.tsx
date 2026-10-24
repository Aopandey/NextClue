"use client";

import { useEffect } from "react";
import type { AnalysisRun, Claim, Finding, PatientRecord, RecordRef, Source, SourceRef } from "@/lib/contracts";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { citationFor, shortClaim } from "@/lib/constellation/citations";
import { systemFor } from "@/lib/constellation/systems";
import { CitationLine } from "./CitationLine";
import { DiseaseMore } from "./DiseaseMore";
import { RecordMore } from "./RecordMore";
import { formatDate } from "./format";

export type DetailPanelProps = {
  run: AnalysisRun;
  patient: PatientRecord;
  sources: Record<string, Source>;
  nodeId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** Phone: bottom sheet instead of the 380px side panel. The page decides; the panel never reads the viewport. */
  narrow?: boolean;
};

type View = {
  label: string;
  color: string;
  meta: string | null;
  /** Line 2: the record quote, or for a hub a computed count. */
  count: string | null;
  quote: RecordRef | null;
  why: string | null;
  cite: SourceRef | null;
  hypothesisId: string | null;
};

const firstSentence = (text: string) => text.split(/(?<=[.!?])\s+/)[0] ?? text;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const overlap = (a: string, b: string) => {
  const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()];
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
};

/**
 * The claim about a finding. Several findings can share one record, so a claim quoting the same excerpt wins;
 * only a present finding falls back to any claim on its record, because a negative is not what such a claim
 * is about. Claims an open question relies on are preferred at each step.
 */
function claimForFinding(finding: Finding, claims: Claim[], openClaimIds: Set<string>): Claim | undefined {
  const pick = (match: (r: RecordRef, cr: RecordRef) => boolean) => {
    const hits = claims.filter((c) => c.record_refs.some((cr) => finding.record_refs.some((r) => r.record_id === cr.record_id && match(r, cr))));
    return hits.find((c) => openClaimIds.has(c.claim_id)) ?? hits[0];
  };
  return pick((r, cr) => overlap(r.excerpt, cr.excerpt)) ?? (finding.assertion === "absent" ? undefined : pick(() => true));
}

function resolve(run: AnalysisRun, patient: PatientRecord, nodeId: string): View | null {
  const out = run.output;
  if (!out) return null;
  const doc = (ref: RecordRef | undefined) => patient.documents.find((d) => d.record_id === ref?.record_id);
  const claim = (id: string | undefined) => out.claims.find((c) => c.claim_id === id);
  const meta = (date: string | null | undefined, specialty: string | null | undefined) =>
    [date && formatDate(date), specialty].filter(Boolean).join(" · ") || null;
  const base = { color: "var(--ink)", count: null, quote: null, why: null, cite: null, hypothesisId: null };

  const hyp = out.hypotheses.find((h) => h.hypothesis_id === nodeId);
  if (hyp) {
    const specialties = new Set<string>();
    const supporting = out.findings.filter((f) => hyp.supporting_finding_ids.includes(f.finding_id));
    supporting.forEach((f) => f.specialty && specialties.add(f.specialty));
    const first = hyp.supporting_claim_ids.map(claim).find((c) => c?.source_refs.length);
    return {
      ...base,
      label: hyp.name,
      meta: null,
      count: `${plural(supporting.length, "supporting finding")} across ${plural(specialties.size, "specialty", "specialties")}`,
      why: firstSentence(hyp.summary),
      cite: first?.source_refs[0] ?? null,
      hypothesisId: hyp.hypothesis_id,
    };
  }

  const finding = out.findings.find((f) => f.finding_id === nodeId);
  if (finding) {
    const quote = finding.record_refs[0] ?? null;
    const openClaimIds = new Set(out.hypotheses.filter((h) => h.status === "open").flatMap((h) => h.supporting_claim_ids));
    const linked = claimForFinding(finding, out.claims, openClaimIds);
    return {
      ...base,
      label: finding.label,
      color: `var(--${systemFor(finding)})`,
      meta: meta(finding.date, finding.specialty),
      quote,
      why: linked ? shortClaim(linked.text) : null,
      cite: linked?.source_refs[0] ?? null,
    };
  }

  const prior = out.prior_results.find((p) => p.prior_result_id === nodeId);
  if (prior) {
    const quote = prior.record_refs[0] ?? null;
    const d = doc(quote ?? undefined);
    return {
      ...base,
      label: prior.test_name,
      meta: meta(d?.date, d?.specialty),
      quote,
      why: prior.what_it_established,
      cite: claim(prior.limitation_claim_ids[0])?.source_refs[0] ?? null,
    };
  }

  const missing = out.missing_evidence.find((m) => m.missing_id === nodeId);
  if (missing) {
    const quote = missing.existing_record_refs[0] ?? null;
    const d = doc(quote ?? undefined);
    return {
      ...base,
      label: missing.description,
      color: "var(--sig)",
      meta: meta(d?.date, d?.specialty),
      count: missing.check_existing_first ? "Check existing records first" : null,
      quote,
      why: missing.why_it_matters,
      cite: claim(missing.claim_ids[0])?.source_refs[0] ?? null,
    };
  }
  return null;
}

function Body({
  view,
  props,
  Heading,
}: {
  view: View;
  props: DetailPanelProps;
  Heading: React.ElementType;
}) {
  const { run, patient, sources, nodeId, onSelect } = props;
  const out = run.output!;
  const cite = view.cite ? citationFor(sources[view.cite.source_id], view.cite.excerpt_id) : null;
  const doc = patient.documents.find((d) => d.record_id === view.quote?.record_id);
  const hypothesis = out.hypotheses.find((h) => h.hypothesis_id === view.hypothesisId);
  const alsoIn = doc
    ? out.findings.filter((f) => f.finding_id !== nodeId && f.record_refs.some((r) => r.record_id === doc.record_id))
    : [];

  return (
    <div className="pt-1">
      <div data-testid="condensed" className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 pr-10">
          <Heading className="text-[15px] font-bold leading-snug text-[var(--ink)]">{view.label}</Heading>
          {view.meta && <span className="font-mono text-[11.5px] text-[var(--mut)]">{view.meta}</span>}
        </div>
        {view.quote && (
          <p className="font-serif text-[15px]">
            “{view.quote.excerpt}” <code className="ml-1.5 font-mono text-[10.5px] text-[var(--mut)]">{view.quote.record_id}</code>
          </p>
        )}
        {view.count && <p className="text-[13.5px] text-[var(--mut)]">{view.count}</p>}
        {view.why && (
          <p className="text-[13.5px]">
            <span className="mr-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--mut)]">Why it matters:</span>
            {view.why}
          </p>
        )}
        {view.cite && <CitationLine source={sources[view.cite.source_id]} excerptId={view.cite.excerpt_id} />}
      </div>

      {cite?.quote?.trim() && (
        <details>
          <summary>Source quote</summary>
          <p className="font-serif text-[14px] text-[var(--ink)]">
            “{cite.quote}”{cite.location && <span className="ml-2 font-mono text-[11px] text-[var(--mut)]">{cite.location}</span>}
          </p>
        </details>
      )}
      {doc && view.quote && <RecordMore doc={doc} excerpt={view.quote.excerpt} alsoIn={alsoIn} onSelect={onSelect} />}
      {hypothesis && <DiseaseMore hypothesis={hypothesis} output={out} sources={sources} onSelect={onSelect} />}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close"
      onClick={onClose}
      className="absolute right-1 top-1 z-10 flex size-10 items-center justify-center bg-[var(--bg)] text-[22px] leading-none text-[var(--mut)] hover:text-[var(--ink)]"
    >
      <span aria-hidden>×</span>
    </button>
  );
}

/** The panel's only scrolling part: Close stays outside it, so it is always reachable. */
function Scroll({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="panel-scroll" className="min-h-0 flex-1 overflow-y-auto p-3.5">
      {children}
    </div>
  );
}

export function DetailPanel(props: DetailPanelProps) {
  const { run, patient, nodeId, onClose, narrow = false } = props;

  // The desktop panel is not a dialog, so Escape is handled here; the phone sheet gets it from Radix.
  useEffect(() => {
    if (narrow) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [narrow, onClose]);

  const view = resolve(run, patient, nodeId);
  if (!view) return null;
  const style = { borderTopColor: view.color } as React.CSSProperties;

  if (narrow) {
    return (
      <Sheet open modal={false} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          style={style}
          className="detail-panel max-h-[45vh] gap-0 overflow-hidden border-t-[3px] border-[var(--line)] bg-[var(--bg)] text-[14px] text-[var(--ink)] shadow-none"
        >
          <Scroll>
            <Body view={view} props={props} Heading={SheetTitle} />
          </Scroll>
          <CloseButton onClose={onClose} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside
      aria-label="Detail"
      style={style}
      className="detail-panel sticky top-0 flex h-dvh w-[380px] shrink-0 flex-col border-l border-t-[3px] border-[var(--line)] bg-[var(--bg)] text-[14px] text-[var(--ink)]"
    >
      <Scroll>
        <Body view={view} props={props} Heading="h2" />
      </Scroll>
      <CloseButton onClose={onClose} />
    </aside>
  );
}
