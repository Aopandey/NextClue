import type { Finding, PatientDocument } from "@/lib/contracts";
import { Section } from "./Section";
import { formatDate } from "./format";

function Marked({ text, excerpt }: { text: string; excerpt: string }) {
  const at = text.indexOf(excerpt);
  if (at < 0 || !excerpt) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{excerpt}</mark>
      {text.slice(at + excerpt.length)}
    </>
  );
}

export function RecordMore({
  doc,
  excerpt,
  alsoIn,
  onSelect,
}: {
  doc: PatientDocument;
  excerpt: string;
  alsoIn: Finding[];
  onSelect: (id: string) => void;
}) {
  return (
    <Section title="More about this record">
      <p className="font-mono text-[11px] text-[var(--mut)]">
        {[doc.title, doc.author_role, formatDate(doc.date), doc.specialty, doc.record_id].filter(Boolean).join(" · ")}
      </p>
      <p className="font-serif text-[14px] leading-[1.45] text-[var(--ink)]">
        <Marked text={doc.text} excerpt={excerpt} />
      </p>
      {doc.observations.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th>Reference</th>
              <th>Interpretation</th>
            </tr>
          </thead>
          <tbody>
            {doc.observations.map((o) => (
              <tr key={o.name}>
                <td>{o.name}</td>
                <td>{[o.value, o.unit].filter(Boolean).join(" ")}</td>
                <td>{o.reference_range ?? "-"}</td>
                <td>{o.interpretation.replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {alsoIn.length > 0 && (
        <>
          <h3 className="hd">Also in this record</h3>
          <ul className="jl">
            {alsoIn.map((f) => (
              <li key={f.finding_id}>
                <button type="button" onClick={() => onSelect(f.finding_id)}>
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
