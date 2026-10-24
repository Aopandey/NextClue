import type { AnalysisOutput, Claim, Hypothesis, Source } from "@/lib/contracts";
import { systemFor } from "@/lib/constellation/systems";
import { CitationLine } from "./CitationLine";
import { Section } from "./Section";

function ClaimList({ claims, sources }: { claims: Claim[]; sources: Record<string, Source> }) {
  return (
    <ul className="cl">
      {claims.map((c) => (
        <li key={c.claim_id}>
          {c.text}
          {c.source_refs[0] && (
            <CitationLine variant="short" source={sources[c.source_refs[0].source_id]} excerptId={c.source_refs[0].excerpt_id} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function DiseaseMore({
  hypothesis,
  output,
  sources,
  onSelect,
}: {
  hypothesis: Hypothesis;
  output: AnalysisOutput;
  sources: Record<string, Source>;
  onSelect: (id: string) => void;
}) {
  const claim = (id: string) => output.claims.find((c) => c.claim_id === id);
  const supporting = hypothesis.supporting_claim_ids.map(claim).filter((c): c is Claim => !!c);
  const contradicting = hypothesis.contradicting_claim_ids.map(claim).filter((c): c is Claim => !!c);
  const findings = hypothesis.supporting_finding_ids.flatMap((id) => output.findings.filter((f) => f.finding_id === id));
  // Priority 1 first (CLAUDE.md), ties in array order (Array.prototype.sort is stable).
  const missing = output.missing_evidence
    .filter((m) => m.hypothesis_ids.includes(hypothesis.hypothesis_id))
    .sort((a, b) => a.priority - b.priority);
  const missingIds = new Set(missing.map((m) => m.missing_id));
  const questions = output.clinician_questions.filter((q) => q.missing_ids.some((id) => missingIds.has(id)));

  return (
    <>
      {findings.length > 0 && (
        <Section title="Supporting findings" count={findings.length} open>
          <ul className="fl">
            {findings.map((f) => (
              <li key={f.finding_id} data-testid="supporting-finding">
                <span className="dot" style={{ background: `var(--${systemFor(f)})` }} />
                <button type="button" onClick={() => onSelect(f.finding_id)}>
                  {f.label}
                </button>
                {f.specialty && <span className="sp">{f.specialty}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {missing.length > 0 && (
        <Section title="Missing evidence" count={missing.length} open>
          {missing.map((m) => (
            <div key={m.missing_id} className="mi" data-testid="missing-item">
              <span className="p">P{m.priority}</span>
              <span className="d">{m.description}</span>
              <p className="w">{m.why_it_matters}</p>
              {m.possible_outcomes.length > 0 && (
                <ul className="oc">
                  {m.possible_outcomes.map((o, i) => (
                    <li key={`${m.missing_id}-${i}`} data-testid="outcome-row">
                      <span className="o">{o.outcome}</span>
                      <span className="i">{o.implication}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </Section>
      )}

      <Section title="Summary">
        <p className="text-[13.5px] text-[var(--ink)]">{hypothesis.summary}</p>
      </Section>

      {supporting.length > 0 && (
        <Section title="Supporting claims" count={supporting.length}>
          <ClaimList claims={supporting} sources={sources} />
        </Section>
      )}
      {contradicting.length > 0 && (
        <Section title="Contradicting claims" count={contradicting.length}>
          <ClaimList claims={contradicting} sources={sources} />
        </Section>
      )}

      {questions.length > 0 && (
        <Section title="Questions for the clinician" count={questions.length}>
          <ul className="cl">
            {questions.map((q) => (
              <li key={q.question_id}>{q.text}</li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
