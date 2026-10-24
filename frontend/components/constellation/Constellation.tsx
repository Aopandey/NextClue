"use client";

import { useMemo, useState } from "react";
import type { AnalysisRun } from "@/lib/contracts";
import { VIEW_NARROW, type EdgePos, type HubPos, type Layout, type NodePos } from "@/lib/constellation/layout";
import { CheckFirst, checkFirstBox, checkFirstItem } from "./CheckFirst";
import { Edge } from "./Edge";
import { Hub, hubStatusBox } from "./Hub";
import { Node, labelGeometry, labelLines, zoomLevel, type Box, type Side } from "./Node";
import "./constellation.css";

export { truncate } from "./Node";

type Props = {
  run: AnalysisRun;
  layout: Layout;
  selectedId: string | null;
  onSelect: (id: string) => void;
  zoomScale: number;
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

/**
 * Label side per node, decided once from the at-rest labels so labels never jump while zooming: the first
 * preferred side whose estimated text box stays inside the view and clears every other circle, every label
 * placed before it, the hub status lines and the Check first box. When no side is clear, the first preference.
 */
function placeLabels(layout: Layout, narrow: boolean, blocked: Box[]): Map<string, Side> {
  const circles = [...layout.hubs, ...layout.nodes];
  const placed = [...blocked];
  const sides = new Map<string, Side>();
  for (const n of layout.nodes) {
    const lines = labelLines(n, narrow, "labels");
    const boxAt = (side: Side) => {
      const { box } = labelGeometry(lines, side, n.r);
      return { x0: box.x0 + n.x, y0: box.y0 + n.y, x1: box.x1 + n.x, y1: box.y1 + n.y };
    };
    const fits = (b: Box) =>
      b.x0 >= 0 && b.y0 >= 0 && b.x1 <= layout.view.w && b.y1 <= layout.view.h &&
      circles.every((c) => c.id === n.id || !hitsCircle(b, c)) &&
      placed.every((p) => !overlaps(p, b));
    const options = sidePreference(n, layout.view, layout.hubs, narrow);
    const side = options.find((s) => fits(boxAt(s))) ?? options[0];
    sides.set(n.id, side);
    placed.push(boxAt(side));
  }
  return sides;
}

const EDGE_COLOR = { previously_tested: "var(--blood)", would_clarify: "var(--sig)" } as const;

/** The clue constellation drawn from a layout: edges, open-question hubs, nodes and the Check first marker. */
export function Constellation({ run, layout, selectedId, onSelect, zoomScale }: Props) {
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
  const sides = useMemo(
    () =>
      placeLabels(layout, narrow, [
        ...layout.hubs.map((h) => hubStatusBox(h, narrow)),
        ...(checkFirst ? [checkFirstBox(layout.view, narrow)] : []),
      ]),
    [layout, narrow, checkFirst],
  );
  const systemOf = new Map(layout.nodes.map((n) => [n.id, n.system]));
  const events = { onSelect, onHover: setHoverId, onFocus: setFocusId };

  return (
    <svg className="cn" viewBox={`0 0 ${layout.view.w} ${layout.view.h}`} role="group" aria-label="Clue constellation">
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
          side={sides.get(n.id) ?? "b"}
          narrow={narrow}
          zoom={zoom}
          scale={zoomScale}
          selected={n.id === selectedId}
          dim={dim(n.id)}
          order={i + 1}
          finding={findings.get(n.id)}
          missing={missing.get(n.id)}
          {...events}
        />
      ))}
      {layout.emptyMessage && (
        <text data-label className="cn-empty" x={layout.view.w / 2} y={layout.view.h / 2} textAnchor="middle">
          {layout.emptyMessage}
        </text>
      )}
      {checkFirst && <CheckFirst item={checkFirst} view={layout.view} narrow={narrow} />}
    </svg>
  );
}
