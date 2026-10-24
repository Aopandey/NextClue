import type { AnalysisOutput, Claim, Hypothesis, Source } from "@/lib/contracts";
import { CitationLine } from "./CitationLine";

function ClaimList({ claims, sources }: { claims: Claim[]; sources: Record<string, Source> }) {
  return (
    <ul className="cl-list">
      {claims.map((c) => (
        <li key={c.claim_id} className="py-1">
          <p className="text-[13px] text-[var(--ink)]">{c.text}</p>
          {c.source_refs[0] && (
            <CitationLine source={sources[c.source_refs[0].source_id]} excerptId={c.source_refs[0].excerpt_id} />
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
  const missing = output.missing_evidence.filter((m) => m.hypothesis_ids.includes(hypothesis.hypothesis_id));
  const missingIds = new Set(missing.map((m) => m.missing_id));
  const questions = output.clinician_questions.filter((q) => q.missing_ids.some((id) => missingIds.has(id)));

  return (
    <details>
      <summary>More about this disease</summary>
      <p className="text-[13px] text-[var(--ink)]">{hypothesis.summary}</p>

      <h3 className="hd">Supporting findings</h3>
      <ul className="jl">
        {findings.map((f) => (
          <li key={f.finding_id} data-testid="supporting-finding">
            <button type="button" onClick={() => onSelect(f.finding_id)}>
              {f.label}
            </button>
          </li>
        ))}
      </ul>

      {supporting.length > 0 && (
        <>
          <h3 className="hd">Supporting claims</h3>
          <ClaimList claims={supporting} sources={sources} />
        </>
      )}
      {contradicting.length > 0 && (
        <>
          <h3 className="hd">Contradicting claims</h3>
          <ClaimList claims={contradicting} sources={sources} />
        </>
      )}

      {missing.length > 0 && (
        <>
          <h3 className="hd">Missing evidence</h3>
          {missing.map((m) => (
            <div key={m.missing_id} className="py-1">
              <p className="text-[13px] font-semibold text-[var(--ink)]">{m.description}</p>
              <p className="text-[13px]">{m.why_it_matters}</p>
              <table>
                <thead>
                  <tr>
                    <th>Outcome</th>
                    <th>What it would mean</th>
                  </tr>
                </thead>
                <tbody>
                  {m.possible_outcomes.map((o, i) => (
                    <tr key={`${m.missing_id}-${i}`} data-testid="outcome-row">
                      <td>{o.outcome}</td>
                      <td>{o.implication}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      {questions.length > 0 && (
        <>
          <h3 className="hd">Questions for the clinician</h3>
          <ul className="cl-list">
            {questions.map((q) => (
              <li key={q.question_id} className="py-1 text-[13px] text-[var(--ink)]">
                {q.text}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
