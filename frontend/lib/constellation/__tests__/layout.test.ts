import { describe, expect, it } from "vitest";
import fixtureJson from "@/fixtures/sarah-001.run.json";
import type { AnalysisRun, Hypothesis } from "@/lib/contracts";
import { layoutConstellation, type Layout } from "../layout";

const fixtureRun = fixtureJson as AnalysisRun;

// ---------------------------------------------------------------- helpers (test-only runs never reach the UI)

const clone = (run: AnalysisRun): AnalysisRun => structuredClone(run);

/** Min over all node/hub pairs of (centre distance − r1 − r2). */
function minGap(L: Layout): number {
  const circles = [...L.hubs, ...L.nodes];
  let min = Infinity;
  for (let i = 0; i < circles.length; i++)
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i], b = circles[j];
      min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r);
    }
  return min;
}

/** Min distance from any node/hub edge to the view border. */
function minMargin(L: Layout): number {
  return Math.min(...[...L.hubs, ...L.nodes].map((c) => Math.min(c.x - c.r, L.view.w - c.x - c.r, c.y - c.r, L.view.h - c.y - c.r)));
}

/** Min over edges and the circles they do not join of (distance from the sampled curve − r). */
function minEdgeClearance(L: Layout): number {
  const circles = [...L.hubs, ...L.nodes];
  let min = Infinity;
  for (const e of L.edges) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = e.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    for (let i = 0; i <= 100; i++) {
      const t = i / 100, u = 1 - t;
      const x = u ** 3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3;
      const y = u ** 3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3;
      for (const c of circles) if (c.id !== e.from && c.id !== e.to) min = Math.min(min, Math.hypot(x - c.x, y - c.y) - c.r);
    }
  }
  return min;
}

function withAllExcluded(run: AnalysisRun): AnalysisRun {
  const r = clone(run);
  r.output!.hypotheses.forEach((h) => { h.status = "excluded"; });
  return r;
}

function withSeparateLessSupported(run: AnalysisRun): AnalysisRun {
  const r = clone(run);
  r.output!.hypotheses.find((h) => h.hypothesis_id === "hyp-separate-conditions")!.status = "less_supported";
  return r;
}

function withThirdHypothesis(run: AnalysisRun): AnalysisRun {
  const r = clone(run);
  const third: Hypothesis = {
    hypothesis_id: "hyp-test-third",
    name: "Test third question",
    is_rare_disease: false,
    status: "open",
    summary: "Test-only hypothesis.",
    supporting_finding_ids: ["fnd-proteinuria"],
    supporting_claim_ids: [],
    contradicting_claim_ids: [],
  };
  r.output!.hypotheses.push(third);
  r.graph!.nodes.push({ node_id: "hyp-test-third", type: "hypothesis", label: "Test third question" });
  r.graph!.edges.push({ edge_id: "fnd-proteinuria--supports--hyp-test-third", source: "fnd-proteinuria", target: "hyp-test-third", relation: "supports" });
  return r;
}

/** Perpendicular distance of point p from the line through a and b. */
function offChord(p: number[], a: number[], b: number[]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  return Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.hypot(dx, dy);
}

const sarah = layoutConstellation(fixtureRun);
const hubXY = (L: Layout) => L.hubs.map((h) => [h.x, h.y]);
const node = (L: Layout, id: string) => L.nodes.find((n) => n.id === id)!;

// ---------------------------------------------------------------- plan tests (R14: scale tests removed)

describe("layoutConstellation (Sarah, desktop)", () => {
  it("Sarah: 2 hubs side by side, Fabry first", () => { expect(sarah.hubs.map(h=>[h.id,h.x,h.y])).toEqual([["hyp-fabry",480,380],["hyp-separate-conditions",720,380]]); });
  it("Sarah: GLA report sits between the two hubs it would clarify; father's diagnosis in the right column", () => { const m = (id:string)=>sarah.nodes.find(n=>n.id===id)!; expect([m("mis-gla-report").x, m("mis-gla-report").y]).toEqual([600,380]); expect(m("mis-father-diagnosis").x).toBe(1080); });
  it("Sarah: 7 findings, 2 negatives, 1 prior, 2 missing", () => { const k = (t:string)=>sarah.nodes.filter(n=>n.kind===t).length; expect([k("finding"),k("negative"),k("prior"),k("missing")]).toEqual([7,2,1,2]); });
  it("Sarah: 13 graph edges kept with their relations", () => expect(sarah.edges.map(e=>e.relation).sort()).toEqual([...Array(9).fill("supports"),"previously_tested",...Array(3).fill("would_clarify")].sort()));
  it("no two nodes overlap (gap ≥ 8px) for Sarah", () => expect(minGap(sarah)).toBeGreaterThanOrEqual(8));
  it("no open hypotheses → empty message", () => expect(layoutConstellation(withAllExcluded(fixtureRun)).emptyMessage).toBe("No open questions in this run"));
  it("failed run → empty layout, no throw", () => expect(layoutConstellation({ ...fixtureRun, status:"failed", output:null }).nodes).toEqual([]));
  it("is deterministic", () => expect(layoutConstellation(fixtureRun)).toEqual(layoutConstellation(fixtureRun)));
});

// ---------------------------------------------------------------- added by the brief

describe("layoutConstellation details", () => {
  it("uses the desktop view, hub r 50, names and support counts", () => {
    expect(sarah.view).toEqual({ w: 1200, h: 760 });
    expect(sarah.hubs.map((h) => [h.name, h.r, h.supportCount])).toEqual([["Fabry disease", 50, 7], ["Separate common conditions", 50, 2]]);
    expect(sarah.emptyMessage).toBeNull();
    expect(minMargin(sarah)).toBeGreaterThanOrEqual(8);
  });

  it("orders ring nodes by body system then date, with systems, labels, years and radii from data", () => {
    const ring = sarah.nodes.filter((n) => n.kind === "finding" || n.kind === "negative");
    expect(ring.map((n) => [n.id, n.kind, n.system, n.year, n.r])).toEqual([
      ["fnd-limb-pain", "finding", "nerve", "2012", 26],
      ["fnd-small-fiber-neuropathy", "finding", "nerve", "2016", 26],
      ["fnd-reduced-sweating", "finding", "sweat", "2012", 26],
      ["fnd-gi-symptoms", "finding", "gut", "2014", 26],
      ["fnd-celiac-negative", "negative", "gut", "2014", 14],
      ["fnd-proteinuria", "finding", "kidney", "2021", 26],
      ["fnd-cornea-verticillata", "finding", "eye", "2023", 26],
      ["fnd-father-dialysis", "finding", "family", "2021", 26],
      ["fnd-diabetes-absent", "negative", "blood", "2016", 14],
    ]);
    expect(node(sarah, "fnd-limb-pain").label).toBe("Burning pain in hands and feet since adolescence");
    expect(sarah.nodes.some((n) => n.id === "fnd-enzyme-normal")).toBe(false);
  });

  it("places ring nodes on the ellipse within the 35°→145° and 215°→325° arcs, never on the endpoints", () => {
    for (const n of sarah.nodes.filter((n) => n.kind === "finding" || n.kind === "negative")) {
      const [cx, cy] = [(n.x - 600) / 400, (n.y - 380) / 285];
      expect(Math.hypot(cx, cy)).toBeCloseTo(1, 2);
      const deg = ((Math.atan2(cy, cx) * 180) / Math.PI + 360) % 360;
      expect((deg > 35 && deg < 145) || (deg > 215 && deg < 325)).toBe(true);
    }
  });

  it("prior and missing nodes carry their system, label, year and radius", () => {
    expect(node(sarah, "pri-enzyme-2016")).toMatchObject({ kind: "prior", system: "blood", x: 120, y: 380, r: 26, label: "2016 alpha-Gal A enzyme screen", year: "2016" });
    expect(node(sarah, "mis-gla-report")).toMatchObject({ kind: "missing", system: "other", r: 26, label: "GLA gene molecular testing report", year: null });
    expect(node(sarah, "mis-father-diagnosis")).toMatchObject({ x: 1080, y: 380, year: null });
  });

  it("edges keep graph ids and endpoints; every d is a visibly curved cubic Bézier of width 1.5", () => {
    expect(sarah.edges.map((e) => e.id)).toEqual(fixtureRun.graph!.edges.map((e) => e.edge_id));
    expect(sarah.edges[0]).toMatchObject({ from: "fnd-limb-pain", to: "hyp-fabry", relation: "supports" });
    for (const e of sarah.edges) {
      expect(e.d).toMatch(/^M[\d.\s,-]+C/);
      expect(e.width).toBe(1.5);
      const [x0, y0, x1, y1, x2, y2, x3, y3] = e.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      expect(offChord([x1, y1], [x0, y0], [x3, y3])).toBeGreaterThan(1);
      expect(offChord([x2, y2], [x0, y0], [x3, y3])).toBeGreaterThan(1);
    }
  });

  it("no Sarah edge cuts through a node it does not join (desktop and phone)", () => {
    expect(minEdgeClearance(sarah)).toBeGreaterThan(0);
    expect(minEdgeClearance(layoutConstellation(fixtureRun, { narrow: true }))).toBeGreaterThan(0);
  });

  it("no open hypotheses: no hubs or edges, drawable nodes stay", () => {
    const L = layoutConstellation(withAllExcluded(fixtureRun));
    expect(L.hubs).toEqual([]);
    expect(L.edges).toEqual([]);
    expect(L.nodes).toHaveLength(12);
    expect(minGap(L)).toBeGreaterThanOrEqual(8);
  });

  it("failed run also yields no hubs, no edges and no empty message", () => {
    const L = layoutConstellation({ ...fixtureRun, status: "failed", output: null });
    expect([L.hubs, L.edges, L.emptyMessage]).toEqual([[], [], null]);
    expect(layoutConstellation({ ...fixtureRun, graph: null }).nodes).toEqual([]);
  });

  it("does not mutate the run", () => {
    const run = clone(fixtureRun);
    layoutConstellation(run);
    layoutConstellation(run, { narrow: true });
    expect(run).toEqual(fixtureRun);
  });

  it("1 hub: centred; GLA report joins the right column by priority; edges to the non-hub are dropped", () => {
    const L = layoutConstellation(withSeparateLessSupported(fixtureRun));
    expect(L.hubs.map((h) => [h.id, h.x, h.y])).toEqual([["hyp-fabry", 600, 380]]);
    expect(["mis-gla-report", "mis-father-diagnosis"].map((id) => [node(L, id).x, node(L, id).y])).toEqual([[1080, 335], [1080, 425]]);
    expect(L.edges.some((e) => e.to === "hyp-separate-conditions")).toBe(false);
    expect(L.edges).toHaveLength(10);
    expect(minGap(L)).toBeGreaterThanOrEqual(8);
  });

  it("3 hubs: triangle in support order; GLA report at the centroid of the two hubs it links", () => {
    const L = layoutConstellation(withThirdHypothesis(fixtureRun));
    expect(L.hubs.map((h) => h.id)).toEqual(["hyp-fabry", "hyp-separate-conditions", "hyp-test-third"]);
    expect(hubXY(L)).toEqual([[600, 300], [490, 470], [710, 470]]);
    expect([node(L, "mis-gla-report").x, node(L, "mis-gla-report").y]).toEqual([545, 385]);
    expect(L.edges).toHaveLength(14);
    expect(minGap(L)).toBeGreaterThanOrEqual(8);
  });

  it("hub order tie-break: equal support keeps array order", () => {
    const r = clone(fixtureRun);
    const [fabry, separate] = r.output!.hypotheses;
    separate.supporting_finding_ids = [...fabry.supporting_finding_ids];
    r.output!.hypotheses = [separate, fabry];
    expect(layoutConstellation(r).hubs.map((h) => h.id)).toEqual(["hyp-separate-conditions", "hyp-fabry"]);
  });

  it("missing items sharing a centroid stack vertically through it with ≥ 8px gaps", () => {
    const r = clone(fixtureRun);
    const gla = r.output!.missing_evidence[0];
    r.output!.missing_evidence.push({ ...gla, missing_id: "mis-test-second", priority: 3 });
    const L = layoutConstellation(r);
    const stack = ["mis-gla-report", "mis-test-second"].map((id) => node(L, id));
    expect(stack.map((n) => n.x)).toEqual([600, 600]);
    expect((stack[0].y + stack[1].y) / 2).toBe(380);
    expect(minGap(L)).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------- phone (ruling R10)

describe("layoutConstellation (narrow)", () => {
  const narrow = layoutConstellation(fixtureRun, { narrow: true });

  it("uses the phone view; hubs share a y with Fabry on the left; GLA report at their centroid", () => {
    expect(narrow.view).toEqual({ w: 400, h: 720 });
    const [fabry, separate] = narrow.hubs;
    expect([fabry.id, separate.id]).toEqual(["hyp-fabry", "hyp-separate-conditions"]);
    expect(fabry.y).toBe(separate.y);
    expect(fabry.x).toBeLessThan(separate.x);
    expect(fabry.r).toBe(40);
    const gla = node(narrow, "mis-gla-report");
    expect([gla.x, gla.y]).toEqual([(fabry.x + separate.x) / 2, fabry.y]);
  });

  it("keeps every node and hub inside the view with ≥ 8px margin and gaps ≥ 8px", () => {
    expect(minMargin(narrow)).toBeGreaterThanOrEqual(8);
    expect(minGap(narrow)).toBeGreaterThanOrEqual(8);
  });

  it("has the same node and edge counts as desktop, with phone radii", () => {
    expect(narrow.nodes.map((n) => n.id)).toEqual(sarah.nodes.map((n) => n.id));
    expect(narrow.edges.map((e) => e.id)).toEqual(sarah.edges.map((e) => e.id));
    expect([node(narrow, "fnd-limb-pain").r, node(narrow, "fnd-celiac-negative").r, node(narrow, "pri-enzyme-2016").r, node(narrow, "mis-gla-report").r]).toEqual([20, 11, 20, 20]);
  });

  it("puts the prior, then the other missing items, in one bottom row", () => {
    expect([node(narrow, "pri-enzyme-2016"), node(narrow, "mis-father-diagnosis")].map((n) => [n.x, n.y])).toEqual([[70, 668], [160, 668]]);
  });

  it("1 and 3 hubs stay inside the phone view with gaps ≥ 8px", () => {
    const one = layoutConstellation(withSeparateLessSupported(fixtureRun), { narrow: true });
    const three = layoutConstellation(withThirdHypothesis(fixtureRun), { narrow: true });
    expect(hubXY(one)).toEqual([[200, 330]]);
    expect(hubXY(three)).toEqual([[200, 260], [120, 400], [280, 400]]);
    for (const L of [one, three]) {
      expect(minMargin(L)).toBeGreaterThanOrEqual(8);
      expect(minGap(L)).toBeGreaterThanOrEqual(8);
    }
  });
});
