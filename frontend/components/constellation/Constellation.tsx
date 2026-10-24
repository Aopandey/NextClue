"use client";

import { useMemo, useState, type RefObject } from "react";
import type { AnalysisRun, Finding } from "@/lib/contracts";
import { VIEW_NARROW, type EdgePos, type HubPos, type Layout, type NodeKind, type NodePos } from "@/lib/constellation/layout";
import { CheckFirst, checkFirstBox, checkFirstItem } from "./CheckFirst";
import { Edge } from "./Edge";
import { Hub, hubStatusBox } from "./Hub";
import { DETAIL_SCALE, Node, labelGeometry, labelLines, zoomLevel, type Box, type Line, type Side, type ZoomLevel } from "./Node";
import { SCALE_EXTENT } from "./useZoom";
import "./constellation.css";

export { truncate } from "./Node";

type Props = {
  run: AnalysisRun;
  layout: Layout;
  selectedId: string | null;
  onSelect: (id: string) => void;
  zoomScale: number;
  /** Pan and zoom applied to the drawn content; labels counter-scale through `zoomScale`, not this. */
  transform?: { x: number; y: number; k: number };
  svgRef?: RefObject<SVGSVGElement | null>;
};

/** A node, the edges touching it, and the nodes at their other ends. */
function connectedTo(id: string, edges: EdgePos[]): Set<string> {
  const ids = new Set([id]);
  for (const e of edges)
    if (e.from === id || e.to === id) {
      ids.add(e.id);
      ids.add(e.from);
      ids.add(e.to);
    }
  return ids;
}

const LABEL_RANK: Record<NodeKind, number> = { finding: 0, uncertain: 0, prior: 0, missing: 0, negative: 1, context: 2 };
const SIDE_LABEL_REACH = 0.35; // desktop ring nodes this far out from the centre line prefer side labels
const CLEARANCE = 1; // px kept free around every label box

/**
 * Preferred label sides, best first. Labels go outside the ring: ring nodes above or below (desktop nodes far
 * left or right: beside). Prior and missing items go below, except those between two hubs, whose edges run
 * along the hub axis: above.
 */
function sidePreference(node: NodePos, view: Layout["view"], hubs: HubPos[], narrow: boolean): Side[] {
  const outward: Side = node.x < view.w / 2 ? "l" : "r";
  const vertical: Side = node.y < view.h / 2 ? "t" : "b";
  let order: Side[];
  if (node.kind === "prior" || node.kind === "missing") {
    const between = hubs.some((a) => hubs.some((b) => a.x < node.x && node.x < b.x && Math.abs(a.y - node.y) <= a.r && Math.abs(b.y - node.y) <= b.r));
    order = between ? ["t", "b"] : ["b", "t", "r", "l"];
  } else {
    const reach = Math.abs(node.x - view.w / 2) / (view.w / 2);
    order = !narrow && reach > SIDE_LABEL_REACH ? [outward, vertical] : [vertical, outward];
  }
  return [...new Set<Side>([...order, "t", "b", "l", "r"])];
}

const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 + CLEARANCE && b.x0 < a.x1 + CLEARANCE && a.y0 < b.y1 + CLEARANCE && b.y0 < a.y1 + CLEARANCE;
const hitsCircle = (b: Box, c: { x: number; y: number; r: number }) =>
  Math.hypot(c.x - Math.max(b.x0, Math.min(c.x, b.x1)), c.y - Math.max(b.y0, Math.min(c.y, b.y1))) < c.r + CLEARANCE;

/** Label block placed for one node: its side and the lines it shows. */
export type Placement = { side: Side; lines: Line[] };

/** A label block's box in layout units at zoom `k` (labels are counter-scaled, so they shrink in layout units). */
function blockBox(n: NodePos, lines: Line[], side: Side, k: number): Box {
  const { box } = labelGeometry(lines, side, n.r * k);
  return { x0: n.x + box.x0 / k, y0: n.y + box.y0 / k, x1: n.x + box.x1 / k, y1: n.y + box.y1 / k };
}
const union = (boxes: Box[]): Box => ({
  x0: Math.min(...boxes.map((b) => b.x0)),
  y0: Math.min(...boxes.map((b) => b.y0)),
  x1: Math.max(...boxes.map((b) => b.x1)),
  y1: Math.max(...boxes.map((b) => b.y1)),
});

/**
 * The zooms a placement must hold at. Detail: every edge of a box moves monotonically with the zoom, so the union
 * of the boxes at the threshold and at the maximum zoom bounds the box at every zoom in between, and one
 * placement holds for the whole detail range (labels do not jump while zooming in further).
 */
const scalesFor = (zoom: ZoomLevel) => (zoom === "detail" ? [DETAIL_SCALE, SCALE_EXTENT[1]] : [1]);

/**
 * Label placement per node for a zoom level: the first preferred side whose estimated text box stays inside the
 * view and clears every other circle, every other label and the `blocked` boxes; when no side is clear, the first
 * preference. At rest it is decided once, so labels never jump while zooming between 0.8× and 1.6×. At detail
 * zoom the plain labels are placed first, then each finding gets its detail line only on a side where the whole
 * block still clears everything; a detail line that fits nowhere is dropped.
 */
export function placeLabels(
  layout: Layout,
  narrow: boolean,
  zoom: ZoomLevel,
  findings: Map<string, Finding>,
  blocked: Box[],
): Map<string, Placement> {
  const scales = scalesFor(zoom);
  const circles = [...layout.hubs, ...layout.nodes];
  const boxes = new Map<string, Box>();
  const out = new Map<string, Placement>();
  const boxAt = (n: NodePos, lines: Line[], side: Side) => union(scales.map((k) => blockBox(n, lines, side, k)));
  const fits = (n: NodePos, b: Box) =>
    b.x0 >= 0 && b.y0 >= 0 && b.x1 <= layout.view.w && b.y1 <= layout.view.h &&
    circles.every((c) => c.id === n.id || !hitsCircle(b, c)) &&
    blocked.every((p) => !overlaps(p, b)) &&
    [...boxes].every(([id, p]) => id === n.id || !overlaps(p, b));

  const plain = zoom === "detail" ? "labels" : zoom;
  // Linked nodes first; a negative or unlinked finding whose label fits nowhere goes without one (its name stays
  // in the node's accessible name and the panel), so crowded live runs never stack labels.
  const ranked = [...layout.nodes].sort((a, b) => LABEL_RANK[a.kind] - LABEL_RANK[b.kind]);
  for (const n of ranked) {
    const lines = labelLines(n, narrow, plain);
    if (!lines.length) continue;
    const options = sidePreference(n, layout.view, layout.hubs, narrow);
    const side = options.find((s) => fits(n, boxAt(n, lines, s))) ?? (LABEL_RANK[n.kind] === 0 ? options[0] : null);
    if (!side) continue;
    out.set(n.id, { side, lines });
    boxes.set(n.id, boxAt(n, lines, side));
  }
  if (zoom !== "detail") return out;

  for (const n of layout.nodes) {
    const lines = labelLines(n, narrow, "detail", findings.get(n.id));
    if (lines.length === out.get(n.id)?.lines.length) continue;
    const options = sidePreference(n, layout.view, layout.hubs, narrow);
    const side = options.find((s) => fits(n, boxAt(n, lines, s)));
    if (!side) continue;
    out.set(n.id, { side, lines });
    boxes.set(n.id, boxAt(n, lines, side));
  }
  return out;
}

const EDGE_COLOR = { previously_tested: "var(--blood)", would_clarify: "var(--sig)" } as const;

/** The clue constellation drawn from a layout: edges, open-question hubs, nodes and the Check first marker. */
export function Constellation({ run, layout, selectedId, onSelect, zoomScale, transform = { x: 0, y: 0, k: 1 }, svgRef }: Props) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const activeId = hoverId ?? focusId;
  const connected = useMemo(() => (activeId ? connectedTo(activeId, layout.edges) : null), [activeId, layout.edges]);
  const dim = (id: string) => connected !== null && !connected.has(id);

  const narrow = layout.view.w === VIEW_NARROW.w;
  const zoom = zoomLevel(zoomScale);
  const output = run.output;
  const findings = useMemo(() => new Map(output?.findings.map((f) => [f.finding_id, f])), [output]);
  const missing = useMemo(() => new Map(output?.missing_evidence.map((m) => [m.missing_id, m])), [output]);
  const checkFirst = output ? checkFirstItem(output.missing_evidence) : null;
  const placements = useMemo(() => {
    const status = layout.hubs.flatMap((h) => scalesFor(zoom).map((k) => hubStatusBox(h, narrow, k)));
    // Check first is a fixed overlay: it shares the view's coordinates only at rest; zoomed content passes under it.
    const fixed = checkFirst && zoom !== "detail" ? [checkFirstBox(layout.view, narrow)] : [];
    return placeLabels(layout, narrow, zoom, findings, [...status, ...fixed]);
  }, [layout, narrow, zoom, findings, checkFirst]);
  const systemOf = new Map(layout.nodes.map((n) => [n.id, n.system]));
  const events = { onSelect, onHover: setHoverId, onFocus: setFocusId };

  return (
    <svg ref={svgRef} className="cn" viewBox={`0 0 ${layout.view.w} ${layout.view.h}`} role="group" aria-label="Clue constellation">
      <g data-zoom-layer transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
      <g>
        {layout.edges.map((e) => (
          <Edge
            key={e.id}
            edge={e}
            color={e.relation === "supports" ? `var(--${systemOf.get(e.from) ?? "other"})` : EDGE_COLOR[e.relation]}
            dim={dim(e.id)}
          />
        ))}
      </g>
      {layout.hubs.map((h) => (
        <Hub key={h.id} hub={h} narrow={narrow} zoom={zoom} scale={zoomScale} selected={h.id === selectedId} dim={dim(h.id)} {...events} />
      ))}
      {layout.nodes.map((n, i) => (
        <Node
          key={n.id}
          node={n}
          lines={placements.get(n.id)?.lines ?? []}
          side={placements.get(n.id)?.side ?? "b"}
          narrow={narrow}
          scale={zoomScale}
          selected={n.id === selectedId}
          dim={dim(n.id)}
          order={i + 1}
          missing={missing.get(n.id)}
          {...events}
        />
      ))}
      {layout.emptyMessage && (
        <text data-label className="cn-empty" x={layout.view.w / 2} y={layout.view.h / 2} textAnchor="middle">
          {layout.emptyMessage}
        </text>
      )}
      </g>
      {checkFirst && <CheckFirst item={checkFirst} view={layout.view} narrow={narrow} onSelect={onSelect} />}
    </svg>
  );
}
