import type { HubPos } from "@/lib/constellation/layout";
import { ASCENT, DESCENT, NodeButton, bareWord, textWidth, truncate, type Box, type NodeEvents, type ZoomLevel } from "./Node";

const NAME_MAX = 20; // px, Source Serif 4
const NAME_MIN = 10;
const PADDING = 8;
const STATUS_SIZE = 11; // px, mono
const STATUS_GAP = 4; // between the ring and the status text box

/** Baselines for `n` lines of `size`px, centred on 0. */
function baselines(n: number, size: number): number[] {
  const lh = size * 1.1;
  const first = size * 0.7 - (size * 0.7 + (n - 1) * lh) / 2;
  return Array.from({ length: n }, (_, i) => first + i * lh);
}

const fits = (lines: string[], size: number, r: number) =>
  baselines(lines.length, size).every((y, i) => {
    const reach = Math.max(Math.abs(y - size * 0.7), Math.abs(y + size * 0.2));
    return reach < r && textWidth(lines[i], size, "serif") <= 2 * Math.sqrt(r * r - reach * reach) - PADDING;
  });

/** Largest size from 20px down at which `lines` fit inside the circle (0 if none down to the minimum). */
function fitSize(lines: string[], r: number): number {
  for (let size = NAME_MAX; size >= NAME_MIN; size -= 0.5) if (fits(lines, size, r)) return size;
  return 0;
}

/** Every way to break `words` into `n` lines, keeping word order. */
function splits(words: string[], n: number): string[][] {
  if (n === 1) return [[words.join(" ")]];
  const out: string[][] = [];
  for (let i = 1; i <= words.length - n + 1; i++)
    for (const rest of splits(words.slice(i), n - 1)) out.push([words.slice(0, i).join(" "), ...rest]);
  return out;
}

/**
 * The hub name inside its circle, at the largest size (≤ 20px) that fits: one line, else the best break into
 * 2 lines, or 3 when that is the only way to keep the name readable (e.g. "Separate / common / conditions").
 */
export function hubName(name: string, r: number, narrow: boolean): { lines: string[]; size: number } {
  const text = narrow ? `${bareWord(name.trim().split(/\s+/)[0] ?? "")}?` : truncate(name);
  const words = text.split(/\s+/).filter(Boolean);
  let best = { lines: [text], size: fitSize([text], r) };
  for (let n = 2; n <= Math.min(3, words.length); n++)
    for (const lines of splits(words, n)) {
      const size = fitSize(lines, r);
      if (size > best.size) best = { lines, size };
    }
  return best.size ? best : { lines: best.lines, size: NAME_MIN };
}

const statusText = (hub: HubPos, narrow: boolean) =>
  narrow ? `open · ${hub.supportCount}` : `open · ${hub.supportCount} ${hub.supportCount === 1 ? "finding" : "findings"}`;
const statusBaseline = (r: number) => r + STATUS_GAP + ASCENT * STATUS_SIZE;

/**
 * The status line's estimated text box, in layout units, at zoom `k` (it sits under the hub and is
 * counter-scaled, so it keeps its screen size while the hub grows).
 */
export function hubStatusBox(hub: HubPos, narrow: boolean, k = 1): Box {
  const w = textWidth(statusText(hub, narrow), STATUS_SIZE, "mono") / k;
  const y = hub.y + statusBaseline(hub.r * k) / k;
  return { x0: hub.x - w / 2, y0: y - (ASCENT * STATUS_SIZE) / k, x1: hub.x + w / 2, y1: y + (DESCENT * STATUS_SIZE) / k };
}

type HubProps = NodeEvents & {
  hub: HubPos;
  narrow: boolean;
  zoom: ZoomLevel;
  scale: number;
  selected: boolean;
  dim: boolean;
  hover: boolean;
};

/** An open question: an ink ring with its name inside and "open · N findings" under it. */
export function Hub({ hub, narrow, zoom, scale, ...button }: HubProps) {
  const { lines, size } = hubName(hub.name, hub.r, narrow);
  const ys = baselines(lines.length, size);
  return (
    <NodeButton id={hub.id} x={hub.x} y={hub.y} r={hub.r} name={hub.name} narrow={narrow} order={0} testId="hub" {...button}>
      <circle r={hub.r} fill="var(--bg)" stroke="var(--ink)" strokeWidth={2} />
      <text data-label className="cn-hub-name" textAnchor="middle" fontSize={size} aria-hidden="true">
        {lines.map((line, i) => (
          <tspan key={i} x={0} y={round(ys[i])}>
            {line}
          </tspan>
        ))}
      </text>
      {zoom !== "icons" && (
        // Counter-scaled like node labels: constant text size under zoom.
        <g transform={scale === 1 ? undefined : `scale(${1 / scale})`}>
          <text data-label className="cn-hub-status" textAnchor="middle" y={round(statusBaseline(hub.r * scale))} aria-hidden="true">
            {statusText(hub, narrow)}
          </text>
        </g>
      )}
    </NodeButton>
  );
}

const round = (v: number) => Math.round(v * 10) / 10;
