import type { CSSProperties } from "react";
import { Icon, SYSTEM_ICON } from "@/components/constellation/icons";
import { SYSTEM_LABEL, type BodySystem } from "@/lib/constellation/systems";

const HUB = { x: 250, y: 186, r: 54 };
const MISSING = { x: 62, y: 196 };

// The same background halo the constellation labels use (constellation.css), so text stays readable over edges.
const HALO: CSSProperties = { paintOrder: "stroke", stroke: "var(--bg)", strokeWidth: 4, strokeLinejoin: "round" };

const NODES: { system: BodySystem; x: number; y: number; dx: number; dy: number; anchor: "end" | "start" | "middle" }[] = [
  { system: "nerve", x: 104, y: 86, dx: -30, dy: 5, anchor: "end" },
  { system: "sweat", x: 236, y: 40, dx: 30, dy: 5, anchor: "start" },
  { system: "kidney", x: 372, y: 84, dx: 0, dy: 40, anchor: "middle" },
  { system: "eye", x: 418, y: 226, dx: 0, dy: 40, anchor: "middle" },
  { system: "gut", x: 300, y: 322, dx: 30, dy: 5, anchor: "start" },
  { system: "family", x: 128, y: 300, dx: -30, dy: 5, anchor: "end" },
];

const edgePath = (x: number, y: number) => {
  const mx = (x + HUB.x) / 2 + (y - HUB.y) * 0.18;
  const my = (y + HUB.y) / 2 - (x - HUB.x) * 0.18;
  return `M${x} ${y} Q${mx} ${my} ${HUB.x} ${HUB.y}`;
};

/** Decorative: six specialties linked to one open question, plus one missing piece. Contains no findings. */
export function HeroArt() {
  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 470 360"
        role="img"
        aria-label="Illustration: records from six specialties linked to one open question, with one missing piece of evidence"
        className="block h-auto w-full"
      >
        {NODES.map((n) => (
          <path key={n.system} d={edgePath(n.x, n.y)} fill="none" stroke={`var(--${n.system})`} strokeWidth={1.6} opacity={0.62} />
        ))}
        <path
          d={`M${HUB.x - 50} ${HUB.y + 20} Q150 250 ${MISSING.x + 18} ${MISSING.y + 10}`}
          fill="none"
          stroke="var(--sig)"
          strokeWidth={2}
          strokeDasharray="7 6"
        />
        <circle cx={HUB.x} cy={HUB.y} r={HUB.r} fill="var(--bg)" stroke="var(--ink)" strokeWidth={2} />
        {(["Open", "question"] as const).map((word, i) => (
          <text
            key={word}
            x={HUB.x}
            y={HUB.y + (i === 0 ? -3 : 19)}
            textAnchor="middle"
            style={{ fontFamily: "var(--font-serif)", fontSize: 19, fontWeight: 500, fill: "var(--ink)" }}
          >
            {word}
          </text>
        ))}
        <text x={HUB.x} y={HUB.y + HUB.r + 16} textAnchor="middle" style={{ ...HALO, fontFamily: "var(--font-mono)", fontSize: 11, fill: "var(--mut)" }}>
          open · unconfirmed
        </text>

        {NODES.map((n) => {
          const icon = SYSTEM_ICON[n.system];
          return (
            <g key={n.system}>
              <circle cx={n.x} cy={n.y} r={22} fill={`var(--${n.system})`} />
              <g transform={`translate(${n.x} ${n.y})`}>{icon && <Icon name={icon} size={21} color="#fff" />}</g>
              <text x={n.x + n.dx} y={n.y + n.dy} textAnchor={n.anchor} style={{ ...HALO, fontSize: 13, fontWeight: 700, fill: "var(--ink)" }}>
                {SYSTEM_LABEL[n.system]}
              </text>
            </g>
          );
        })}

        <circle cx={MISSING.x} cy={MISSING.y} r={27} fill="none" stroke="var(--sig)" strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
        <circle cx={MISSING.x} cy={MISSING.y} r={21} fill="var(--bg)" stroke="var(--sig)" strokeWidth={2} strokeDasharray="5 4" />
        <g transform={`translate(${MISSING.x} ${MISSING.y})`}>
          <Icon name="ask" size={21} color="var(--sig)" />
        </g>
        <text x={MISSING.x} y={MISSING.y + 44} textAnchor="middle" style={{ ...HALO, fontSize: 13, fontWeight: 700, fill: "var(--ink)" }}>
          Prior test?
        </text>
        <text x={MISSING.x} y={MISSING.y + 59} textAnchor="middle" style={{ ...HALO, fontSize: 12, fontWeight: 700, fill: "var(--sig)" }}>
          missing?
        </text>
      </svg>
      <figcaption className="mt-1 text-center font-mono text-[10.5px] text-[var(--faint)]">Illustration</figcaption>
    </figure>
  );
}
