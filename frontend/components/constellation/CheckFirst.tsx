import type { MissingEvidence } from "@/lib/contracts";
import { Icon } from "./icons";
import { bareWord, type Box } from "./Node";

/** Ruling R2: "GLA gene molecular testing report" → "GLA report". */
function shortName(description: string): string {
  const w = description.trim().split(/\s+/).map(bareWord).filter(Boolean);
  return w.length > 1 ? `${w[0]} ${w[w.length - 1]}` : (w[0] ?? "");
}

/** The priority-1 missing item, when it should be looked for in existing records first. */
export const checkFirstItem = (missing: MissingEvidence[]) =>
  missing.find((m) => m.priority === 1 && m.check_existing_first) ?? null;

/**
 * Desktop: the free top-right corner, one text line. Phone: the top band is full of top-arc labels, so the
 * bottom-right corner, with the text over two lines to stay clear of the bottom row's labels.
 */
export function checkFirstBox(view: { w: number; h: number }, narrow: boolean): Box {
  const [w, h, inset] = narrow ? [136, 54, 6] : [244, 50, 16];
  const x0 = view.w - inset - w;
  const y0 = narrow ? view.h - inset - h : inset;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** A fixed dashed marker naming the item to look for in existing records before anything is ordered. */
export function CheckFirst({
  item,
  view,
  narrow,
  onSelect,
}: {
  item: MissingEvidence;
  view: { w: number; h: number };
  narrow: boolean;
  onSelect: (id: string) => void;
}) {
  const { x0, y0, x1, y1 } = checkFirstBox(view, narrow);
  const textX = x0 + (narrow ? 9 : 40);
  const name = shortName(item.description);
  return (
    <g
      data-testid="check-first"
      role="button"
      tabIndex={0}
      aria-label={item.description}
      className="cn-node cn-check"
      onClick={() => onSelect(item.missing_id)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect(item.missing_id);
      }}
    >
      <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill="var(--bg)" stroke="var(--sig)" strokeWidth={1.2} strokeDasharray="4 3" />
      {!narrow && (
        <g transform={`translate(${x0 + 20} ${(y0 + y1) / 2})`}>
          <Icon name="doc" size={24} color="var(--sig)" />
        </g>
      )}
      <text data-label className="cn-check-text">
        <tspan x={textX} y={y0 + (narrow ? 16 : 20)} className="cn-check-head">
          CHECK FIRST
        </tspan>
        <tspan className="cn-check-body" data-testid="check-first-body">
          {narrow ? (
            <>
              <tspan x={textX} y={y0 + 32}>{`${name} · `}</tspan>
              <tspan x={textX} y={y0 + 47}>may already exist</tspan>
            </>
          ) : (
            <tspan x={textX} y={y0 + 39}>{`${name} · may already exist`}</tspan>
          )}
        </tspan>
      </text>
    </g>
  );
}
