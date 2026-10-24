import type {
  AnalysisRun,
  EdgeRelation,
  Finding,
  Hypothesis,
  MissingEvidence,
  PriorResultReview,
  TimelineEvent,
} from "@/lib/contracts";
import { SYSTEM_ORDER, systemFor, systemForText, type BodySystem } from "./systems";

// Deterministic constellation layout for one analysis run (Sarah's 10-record view; no clustering, ruling R14).
// Pure: no randomness, no clock, never mutates the run.

export const VIEW = { w: 1200, h: 760 } as const; // desktop
// Phone, ruling R10. The bottom 60 units are kept free for the CHECK FIRST marker, below the side row.
export const VIEW_NARROW = { w: 400, h: 780 } as const;

export type HubPos = { id: string; name: string; x: number; y: number; r: number; supportCount: number };
/**
 * Ring kinds: `finding` (present, linked to a hypothesis), `context` (present, linked to none: drawn small, no
 * edges), `uncertain` (assertion "uncertain") and `negative` (assertion "absent"). Then `prior` and `missing`.
 */
export type NodeKind = "finding" | "context" | "uncertain" | "negative" | "prior" | "missing";
export type NodePos = { id: string; kind: NodeKind; system: BodySystem; x: number; y: number; r: number; label: string; year: string | null };
export type EdgePos = { id: string; from: string; to: string; relation: EdgeRelation; width: number; d: string };
export type Layout = { view: { w: number; h: number }; hubs: HubPos[]; nodes: NodePos[]; edges: EdgePos[]; emptyMessage: string | null };

type Point = { x: number; y: number };
type Circle = Point & { r: number };

interface Geometry {
  view: { w: number; h: number };
  /** Hub centres, indexed by hub count − 1. */
  hubSlots: Point[][];
  hubR: number;
  ring: { cx: number; cy: number; rx: number; ry: number };
  r: Record<NodeKind, number>;
  /** Positions for priors and for missing items that are not at a hub centroid (already ordered by priority). */
  side(priorCount: number, missingCount: number): { priors: Point[]; missing: Point[] };
  /** View height once `sideCount` priors and side missing items are placed. */
  height(sideCount: number): number;
}

/** `count` positions `step` apart, centred on `centre`. */
const spread = (count: number, centre: number, step: number) =>
  Array.from({ length: count }, (_, i) => centre + (i - (count - 1) / 2) * step);

const DESKTOP: Geometry = {
  view: VIEW,
  hubSlots: [
    [{ x: 600, y: 380 }],
    [{ x: 420, y: 380 }, { x: 780, y: 380 }],
    [{ x: 600, y: 300 }, { x: 490, y: 470 }, { x: 710, y: 470 }],
  ],
  hubR: 50,
  ring: { cx: 600, cy: 380, rx: 400, ry: 285 },
  r: { finding: 26, context: 14, uncertain: 26, negative: 14, prior: 26, missing: 26 },
  // Priors in a left column, other missing items in a right column; both 90px apart, centred on y = 380.
  side: (priorCount, missingCount) => ({
    priors: spread(priorCount, 380, 90).map((y) => ({ x: 120, y })),
    missing: spread(missingCount, 380, 90).map((y) => ({ x: 1080, y })),
  }),
  height: () => VIEW.h,
};

const ROW = { x: 70, y: 668, step: 90, perRow: 4 }; // phone side rows

const NARROW: Geometry = {
  view: VIEW_NARROW,
  hubSlots: [
    [{ x: 200, y: 330 }],
    [{ x: 115, y: 330 }, { x: 285, y: 330 }],
    [{ x: 200, y: 260 }, { x: 120, y: 400 }, { x: 280, y: 400 }],
  ],
  hubR: 40,
  ring: { cx: 200, cy: 330, rx: 170, ry: 270 },
  r: { finding: 20, context: 11, uncertain: 20, negative: 11, prior: 20, missing: 20 },
  // Bottom rows of 4: priors first, then the other missing items, 90 apart from x = 70; extra rows go below and
  // grow the view, so the CHECK FIRST band stays under the last row.
  side: (priorCount, missingCount) => {
    const row = Array.from({ length: priorCount + missingCount }, (_, i) => ({
      x: ROW.x + (i % ROW.perRow) * ROW.step,
      y: ROW.y + Math.floor(i / ROW.perRow) * ROW.step,
    }));
    return { priors: row.slice(0, priorCount), missing: row.slice(priorCount) };
  },
  height: (sideCount) => VIEW_NARROW.h + Math.max(0, Math.ceil(sideCount / ROW.perRow) - 1) * ROW.step,
};

const MAX_HUBS = 3;
const EDGE_WIDTH = 1.5;
const NODE_GAP = 8; // minimum clear space between stacked circles (ruling R5)
const EDGE_PULL = 0.35; // control points sit 35% of the way toward the hub
// Sideways push of the control points, as a share of the edge length. Tuned on Sarah's longest edge
// (father's diagnosis → Fabry, along the hub axis on desktop): at 0.19 it clears the GLA report by ~3px and
// the Separate hub on desktop, and "No diabetes" by ~4px on the phone. Below ~0.17 it cuts the GLA report on
// desktop; above ~0.21 it cuts "No diabetes" on the phone.
const EDGE_BEND = 0.19;
const EDGE_TRIM = 4; // the stroke stops this far outside each circle

/** Arcs for ring nodes, in degrees clockwise from 3 o'clock (SVG y grows down, so 90° is the bottom). */
const TOP_ARC: [number, number] = [215, 325];
const BOTTOM_ARC: [number, number] = [35, 145];

export function layoutConstellation(run: AnalysisRun, opts?: { narrow?: boolean }): Layout {
  const geo = opts?.narrow ? NARROW : DESKTOP;
  const { output, graph } = run;
  if (!output) return { view: { ...geo.view }, hubs: [], nodes: [], edges: [], emptyMessage: null };

  const hubs = placeHubs(output.hypotheses, geo);

  // Every finding is drawn; "linked" ones are those the backend's graph gives a node (findings supporting any
  // hypothesis, views.build_graph), which is also the fallback when the graph is missing.
  const linked = new Set(
    graph
      ? graph.nodes.filter((n) => n.type === "finding").map((n) => n.node_id)
      : output.hypotheses.flatMap((h) => h.supporting_finding_ids),
  );
  const missing = placeMissing(output.missing_evidence, output.prior_results.length, geo, hubs);
  const nodes = [
    ...placeRing(sortForRing(output.findings), linked, geo),
    ...placePriors(output.prior_results, run.timeline, output.findings, geo),
    ...missing.nodes,
  ];
  const view = { w: geo.view.w, h: geo.height(output.prior_results.length + missing.sideCount) };

  const circles = new Map<string, Circle>([...hubs, ...nodes].map((c) => [c.id, c]));
  const edges: EdgePos[] = (graph?.edges ?? []).flatMap((e) => {
    const from = circles.get(e.source);
    const to = circles.get(e.target);
    if (!from || !to) return [];
    const others = [...circles.values()].filter((c) => c !== from && c !== to);
    return [{ id: e.edge_id, from: e.source, to: e.target, relation: e.relation, width: EDGE_WIDTH, d: routeEdge(from, to, others) }];
  });

  return { view, hubs, nodes, edges, emptyMessage: hubs.length === 0 ? "No open questions in this run" : null };
}

/** Up to 3 open hypotheses, most supporting findings first, ties in array order. */
function placeHubs(hypotheses: Hypothesis[], geo: Geometry): HubPos[] {
  const open = hypotheses
    .map((h, index) => ({ h, index }))
    .filter(({ h }) => h.status === "open")
    .sort((a, b) => b.h.supporting_finding_ids.length - a.h.supporting_finding_ids.length || a.index - b.index)
    .slice(0, MAX_HUBS);
  const slots = open.length ? geo.hubSlots[open.length - 1] : [];
  return open.map(({ h }, i) => ({
    id: h.hypothesis_id,
    name: h.name,
    ...slots[i],
    r: geo.hubR,
    supportCount: h.supporting_finding_ids.length,
  }));
}

/** By SYSTEM_ORDER, then date (undated last), then array order. */
function sortForRing(findings: Finding[]): Finding[] {
  return findings
    .map((f, index) => ({ f, index, system: SYSTEM_ORDER.indexOf(systemFor(f)) }))
    .sort((a, b) => a.system - b.system || compareDates(a.f.date, b.f.date) || a.index - b.index)
    .map(({ f }) => f);
}

const compareDates = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

/**
 * The two arcs read as one clockwise sweep: the first ⌈n/2⌉ nodes run left → right along the top arc
 * (215°→325°), the rest right → left along the bottom arc (35°→145°). Top-first starts the sweep at the
 * upper left, like the reference, and gives fewer edge crossings for Sarah than bottom-first.
 */
function placeRing(findings: Finding[], linked: Set<string>, geo: Geometry): NodePos[] {
  const topCount = Math.ceil(findings.length / 2);
  const angles = [...arcAngles(topCount, TOP_ARC), ...arcAngles(findings.length - topCount, BOTTOM_ARC)];
  const { cx, cy, rx, ry } = geo.ring;
  return findings.map((f, i) => {
    const kind: NodeKind =
      f.assertion === "absent" ? "negative" : f.assertion === "uncertain" ? "uncertain" : linked.has(f.finding_id) ? "finding" : "context";
    const rad = (angles[i] * Math.PI) / 180;
    return {
      id: f.finding_id,
      kind,
      system: systemFor(f),
      x: round(cx + rx * Math.cos(rad)),
      y: round(cy + ry * Math.sin(rad)),
      r: geo.r[kind],
      label: f.label,
      year: f.date ? f.date.slice(0, 4) : null,
    };
  });
}

/** `count` angles evenly spaced across the arc, inset half a step from each end. */
function arcAngles(count: number, [from, to]: [number, number]): number[] {
  const step = (to - from) / count;
  return Array.from({ length: count }, (_, i) => from + step * (i + 0.5));
}

/**
 * Priors in the geometry's side slots. Year: the timeline entry of their first record, else a dated finding on
 * that record. System: from the test name and the record's specialty.
 */
function placePriors(priors: PriorResultReview[], timeline: TimelineEvent[] | null, findings: Finding[], geo: Geometry): NodePos[] {
  const slots = geo.side(priors.length, 0).priors;
  return priors.map((p, i) => {
    const recordId = p.record_refs[0]?.record_id;
    const event = timeline?.find((t) => t.record_id === recordId);
    const sameRecord = findings.find((f) => f.date && f.record_refs.some((r) => r.record_id === recordId));
    const date = event?.date ?? sameRecord?.date ?? null;
    return {
      id: p.prior_result_id,
      kind: "prior",
      system: systemForText(p.test_name, event?.specialty ?? sameRecord?.specialty),
      ...slots[i],
      r: geo.r.prior,
      label: p.test_name,
      year: date ? date.slice(0, 4) : null,
    };
  });
}

/**
 * Missing items, by priority (then array order). An item linked to 2+ drawn hubs sits at their centroid;
 * items sharing a centroid stack vertically through it with NODE_GAP between them (ruling R5).
 * Every other item takes the geometry's side slots, after the priors.
 */
function placeMissing(items: MissingEvidence[], priorCount: number, geo: Geometry, hubs: HubPos[]): { nodes: NodePos[]; sideCount: number } {
  const hubById = new Map(hubs.map((h) => [h.id, h]));
  const missing = items
    .map((m, index) => ({ m, index }))
    .sort((a, b) => a.m.priority - b.m.priority || a.index - b.index)
    .map(({ m }) => m);

  const centroids = new Map<string, { centre: Point; indices: number[] }>();
  const elsewhere: number[] = [];
  missing.forEach((m, i) => {
    const linked = [...new Set(m.hypothesis_ids)].flatMap((id) => hubById.get(id) ?? []);
    if (linked.length < 2) {
      elsewhere.push(i);
      return;
    }
    const centre = { x: round(mean(linked.map((h) => h.x))), y: round(mean(linked.map((h) => h.y))) };
    const key = `${centre.x},${centre.y}`;
    const group = centroids.get(key) ?? { centre, indices: [] };
    group.indices.push(i);
    centroids.set(key, group);
  });

  const positions: Point[] = [];
  for (const { centre, indices } of centroids.values())
    spread(indices.length, centre.y, 2 * geo.r.missing + NODE_GAP).forEach((y, k) => {
      positions[indices[k]] = { x: centre.x, y };
    });
  const slots = geo.side(priorCount, elsewhere.length).missing;
  elsewhere.forEach((i, k) => {
    positions[i] = slots[k];
  });

  const nodes = missing.map((m, i): NodePos => ({
    id: m.missing_id,
    kind: "missing",
    system: "other",
    ...positions[i],
    r: geo.r.missing,
    label: m.description,
    year: null,
  }));
  return { nodes, sideCount: elsewhere.length };
}

/**
 * Edge path from a node to its hub (`to`): a cubic Bézier `M start C c1 c2 end`.
 * 1. Trim: start and end sit on the chord, EDGE_TRIM px outside each circle.
 * 2. Control points: c1 is pulled 35% of the trimmed chord from the start toward the hub, c2 sits 35% back
 *    from the end; both are then pushed sideways by EDGE_BEND × chord length, to the left of the direction of
 *    travel (a counter-clockwise turn on screen, SVG y grows down). Pushing both the same way gives one smooth
 *    arc that bows 0.75 × EDGE_BEND × length at its middle, so the control points are never collinear with the
 *    ends. Left, not right: on desktop the long edges along the hub axis then bow below the GLA report (its
 *    label sits above it in the reference), and on the phone they miss the finding above the bottom row.
 * Same inputs, same string: coordinates are rounded to 0.1px.
 */
/**
 * The default bend (left), unless it cuts through a node it does not join: crowded live runs put ring nodes or a
 * second hub across a side item's edge. Then the first of a right bend, or a shallower bend either way, that
 * clears every node; if none does, the one that clears most. Sarah's fixture keeps the default everywhere.
 */
const BENDS = [1, -1, 0.5, -0.5, 0.15, -0.15];
function routeEdge(from: Circle, to: Circle, others: Circle[]): string {
  const paths = BENDS.map((bend) => edgePath(from, to, bend));
  const clear = paths.map((d) => clearance(d, others));
  const first = clear.findIndex((c) => c > 0);
  return paths[first >= 0 ? first : clear.indexOf(Math.max(...clear))];
}

/** Smallest distance from the sampled curve to the edge of any of `circles`. */
function clearance(d: string, circles: Circle[]): number {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  let min = Infinity;
  for (let i = 0; i <= 50; i++) {
    const t = i / 50;
    const u = 1 - t;
    const x = u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3;
    const y = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3;
    for (const c of circles) min = Math.min(min, Math.hypot(x - c.x, y - c.y) - c.r);
  }
  return min;
}

/** `bend` scales EDGE_BEND: 1 is the default left bend, negative bends right. */
function edgePath(from: Circle, to: Circle, bend: number): string {
  const dist = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / dist;
  const uy = (to.y - from.y) / dist;
  const trimFrom = from.r + EDGE_TRIM;
  const trimTo = to.r + EDGE_TRIM;
  // Circles too close to trim (never in a valid layout): run centre to centre instead.
  const canTrim = dist > trimFrom + trimTo;
  const start = canTrim ? { x: from.x + ux * trimFrom, y: from.y + uy * trimFrom } : from;
  const end = canTrim ? { x: to.x - ux * trimTo, y: to.y - uy * trimTo } : to;

  const vx = end.x - start.x;
  const vy = end.y - start.y;
  const push = { x: bend * vy * EDGE_BEND, y: -bend * vx * EDGE_BEND };
  const c1 = { x: start.x + vx * EDGE_PULL + push.x, y: start.y + vy * EDGE_PULL + push.y };
  const c2 = { x: end.x - vx * EDGE_PULL + push.x, y: end.y - vy * EDGE_PULL + push.y };
  const pt = (p: Point) => `${round(p.x)} ${round(p.y)}`;
  return `M ${pt(start)} C ${pt(c1)}, ${pt(c2)}, ${pt(end)}`;
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const round = (v: number) => Math.round(v * 10) / 10 + 0; // + 0 turns -0 into 0
