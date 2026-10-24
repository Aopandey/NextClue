import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import fixtureJson from "@/fixtures/sarah-001.run.json";
import jamesLiveJson from "@/fixtures/live/james-002.run.json";
import sarahLiveJson from "@/fixtures/live/sarah-001.run.json";
import type { AnalysisRun } from "@/lib/contracts";
import { layoutConstellation, type Layout } from "@/lib/constellation/layout";
import { Constellation, truncate } from "../Constellation";
import { hubName } from "../Hub";
import { ASCENT, DESCENT, negativeLabel, textWidth } from "../Node";

const fixtureRun = fixtureJson as AnalysisRun;
const jamesLive = jamesLiveJson as AnalysisRun;
const sarahLive = sarahLiveJson as AnalysisRun;
const RUNS = { fixture: fixtureRun, "sarah live": sarahLive, "james live": jamesLive };

function draw(opts: { narrow?: boolean; zoomScale?: number; run?: AnalysisRun; selectedId?: string | null } = {}) {
  const run = opts.run ?? fixtureRun;
  const layout = layoutConstellation(run, { narrow: opts.narrow });
  const onSelect = vi.fn();
  const utils = render(
    <Constellation run={run} layout={layout} selectedId={opts.selectedId ?? null} onSelect={onSelect} zoomScale={opts.zoomScale ?? 1} />,
  );
  return { ...utils, layout, onSelect };
}

const node = (id: string) => document.querySelector<SVGGElement>(`[data-node-id="${id}"]`)!;
const edge = (id: string) => document.querySelector<SVGPathElement>(`[data-edge-id="${id}"]`)!;

/** Words in every SVG text node; tspans are separate text nodes, so lines never run together. */
function visibleWords(container: HTMLElement): number {
  const walker = document.createTreeWalker(container.querySelector("svg")!, NodeFilter.SHOW_TEXT);
  let count = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode())
    count += (t.textContent ?? "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return count;
}

/** Start and end points of a `M x y C x y, x y, x y` path. */
function endpoints(d: string) {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  return [{ x: n[0], y: n[1] }, { x: n[6], y: n[7] }];
}

const circlesOf = (layout: Layout) => [...layout.hubs, ...layout.nodes];

type Rect = { text: string; x0: number; y0: number; x1: number; y1: number };
const TSPAN_FONT: Record<string, [number, "sans" | "serif" | "mono"]> = {
  "cn-l-label": [13, "sans"],
  "cn-l-negative": [13, "sans"],
  "cn-l-year": [11, "mono"],
  "cn-l-signal": [12, "sans"],
};
const translateOf = (el: Element) => {
  const m = el.getAttribute("transform")?.match(/translate\(([-\d.]+) ([-\d.]+)\)/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
};

/**
 * Screen-space text boxes (view units, zoom k applied) of every node label block and hub status line, rebuilt
 * from the rendered SVG with the same text metrics the layout estimates with. The fixed CHECK FIRST overlay is
 * not part of the zoomed graph and is left out.
 */
function labelRects(k: number): Rect[] {
  const rects: Rect[] = [];
  for (const g of document.querySelectorAll("[data-node-id]")) {
    const c = translateOf(g);
    for (const text of g.querySelectorAll("text.cn-label, text.cn-hub-status")) {
      const anchor = text.getAttribute("text-anchor") ?? "start";
      const lines = text.classList.contains("cn-hub-status") ? [text] : [...text.children];
      let box: Omit<Rect, "text"> | null = null;
      for (const line of lines) {
        const y = Number(line.getAttribute("y"));
        const x = Number(line.getAttribute("x") ?? 0);
        const quote = line.querySelector("[data-quote]")?.textContent ?? "";
        const own = (line.textContent ?? "").slice(0, (line.textContent ?? "").length - quote.length);
        const [size, font] = line === text ? [11, "mono" as const] : line.getAttribute("data-testid") === "finding-detail" ? [13, "mono" as const] : TSPAN_FONT[line.getAttribute("class")!];
        const w = line.getAttribute("data-testid") === "finding-detail" ? textWidth(own, 11, "mono") + textWidth(quote, 13, "serif") : textWidth(own, size, font);
        const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
        const b = { x0, y0: y - ASCENT * size, x1: x0 + w, y1: y + DESCENT * size };
        box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
      }
      if (box) rects.push({ text: text.textContent ?? "", x0: box.x0 + c.x * k, y0: box.y0 + c.y * k, x1: box.x1 + c.x * k, y1: box.y1 + c.y * k });
    }
  }
  return rects;
}

function overlapping(rects: Rect[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const [a, b] = [rects[i], rects[j]];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) out.push(`${a.text} | ${b.text}`);
    }
  return out;
}

describe("Constellation", () => {
  it("renders 2 hubs, 12 graph nodes + 2 negatives + 1 unlinked finding, 13 edges for Sarah", () => {
    draw();
    expect(screen.getAllByTestId("hub")).toHaveLength(2);
    expect(document.querySelectorAll("[data-node-id]")).toHaveLength(15);
    expect(document.querySelectorAll("[data-edge-id]")).toHaveLength(13);
  });

  it("is a labelled SVG sized by the layout view", () => {
    const { container } = draw();
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 1200 760");
    expect(svg).toHaveAccessibleName("Clue constellation");
    draw({ narrow: true });
    expect(document.querySelectorAll("svg")[1].getAttribute("viewBox")).toBe("0 0 400 780");
  });

  it("every node and hub is a focusable button named by its full data label", () => {
    draw();
    for (const g of document.querySelectorAll("[data-node-id]")) {
      expect(g.getAttribute("role")).toBe("button");
      expect(g.getAttribute("tabindex")).toBe("0");
    }
    expect(node("fnd-limb-pain")).toHaveAccessibleName("Burning pain in hands and feet since adolescence");
    expect(node("hyp-separate-conditions")).toHaveAccessibleName("Separate common conditions");
    expect(node("pri-enzyme-2016")).toHaveAccessibleName("2016 alpha-Gal A enzyme screen");
    expect(node("mis-gla-report")).toHaveAccessibleName("GLA gene molecular testing report");
    expect(node("fnd-celiac-negative")).toHaveAccessibleName("Celiac serology negative");
  });

  it("Enter on a node calls onSelect with its id", async () => {
    const { onSelect } = draw();
    const user = userEvent.setup();
    node("fnd-proteinuria").focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("fnd-proteinuria");
  });

  it("Space and click also call onSelect, hubs included", async () => {
    const { onSelect } = draw();
    const user = userEvent.setup();
    node("hyp-fabry").focus();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenLastCalledWith("hyp-fabry");
    await user.click(node("mis-gla-report"));
    expect(onSelect).toHaveBeenLastCalledWith("mis-gla-report");
  });

  it("marks the selected node", () => {
    draw({ selectedId: "fnd-proteinuria" });
    expect(node("fnd-proteinuria")).toHaveAttribute("data-selected", "true");
    expect(node("fnd-limb-pain")).not.toHaveAttribute("data-selected");
  });

  it("shows CHECK FIRST for mis-gla-report", () => {
    draw();
    expect(screen.getByText("CHECK FIRST")).toBeInTheDocument();
    expect(screen.getByText("GLA report · may already exist")).toBeInTheDocument();
  });

  it.each([false, true])("CHECK FIRST names the item by its first and last word (narrow: %s)", (narrow) => {
    draw({ narrow });
    expect(screen.getByTestId("check-first-body").textContent).toBe("GLA report · may already exist");
  });

  it("CHECK FIRST is a button named by the item that selects it on click, Enter and Space", async () => {
    const { onSelect } = draw();
    const user = userEvent.setup();
    const box = screen.getByTestId("check-first");
    expect(box).toHaveAttribute("role", "button");
    expect(box).toHaveAccessibleName("GLA gene molecular testing report");
    expect(box.getAttribute("tabindex")).toBe("0");
    await user.click(box);
    expect(onSelect).toHaveBeenLastCalledWith("mis-gla-report");
    onSelect.mockClear();
    box.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("mis-gla-report");
    onSelect.mockClear();
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenLastCalledWith("mis-gla-report");
  });

  it("shows no CHECK FIRST when the priority-1 item needs no check", () => {
    const run = structuredClone(fixtureRun);
    run.output!.missing_evidence.forEach((m) => { m.check_existing_first = false; });
    draw({ run });
    expect(screen.queryByText("CHECK FIRST")).toBeNull();
  });

  it.each([
    [false, "fixture"], [true, "fixture"], [false, "sarah live"], [true, "sarah live"],
  ] as const)("CHECK FIRST box clears every node and hub circle (narrow: %s, %s)", (narrow, name) => {
    const { layout } = draw({ narrow, run: RUNS[name] });
    const rect = screen.getByTestId("check-first").querySelector("rect")!;
    const [x, y, w, h] = ["x", "y", "width", "height"].map((a) => Number(rect.getAttribute(a)));
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(x + w).toBeLessThanOrEqual(layout.view.w);
    expect(y + h).toBeLessThanOrEqual(layout.view.h);
    for (const c of circlesOf(layout)) {
      const nx = Math.max(x, Math.min(c.x, x + w));
      const ny = Math.max(y, Math.min(c.y, y + h));
      expect(Math.hypot(c.x - nx, c.y - ny), c.id).toBeGreaterThan(c.r);
    }
  });

  it.each([false, true])("at rest shows ≤ 70 words (narrow: %s)", (narrow) => {
    const { container } = draw({ narrow });
    expect(visibleWords(container)).toBeLessThanOrEqual(70);
  });

  it("desktop labels: truncated findings with years, negatives, prior, missing, hubs", () => {
    draw();
    for (const text of [
      "Burning pain in hands and…", "2012", "Rarely sweats", "Persistent proteinuria (UACR…",
      "Celiac serology negative", "No diabetes",
      "2016 alpha-Gal A enzyme…",
      "GLA gene molecular", "Cause of father's", "open · 7 findings", "open · 2 findings",
    ])
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    expect(node("fnd-celiac-negative").textContent).not.toMatch(/\d{4}/);
    expect(node("pri-enzyme-2016").textContent).not.toMatch(/normal|conclusive/i);
  });

  it.each([false, true])("a prior is labelled from its data only, never with a hard-coded status (James, narrow: %s)", (narrow) => {
    draw({ run: jamesLive, narrow });
    const text = node("pri-001").textContent!;
    expect(text).toContain("2018");
    if (!narrow) expect(text).toContain("Vitamin B12 level");
    expect(text).not.toMatch(/normal|conclusive/i);
  });

  it("negative labels keep the whole finding: James's 'Weight loss' and 'Foot ulcer'", () => {
    expect(negativeLabel("Weight loss")).toBe("No weight loss");
    expect(negativeLabel("Foot ulcer")).toBe("No foot ulcer");
    expect(negativeLabel("Diarrhea")).toBe("No diarrhea");
    expect(negativeLabel("GERD")).toBe("No GERD");
    expect(negativeLabel("No diabetes (HbA1c 5.2%)")).toBe("No diabetes");
    expect(negativeLabel("Celiac serology negative")).toBe("Celiac serology negative");
    expect(negativeLabel("Absent ankle reflexes on both sides of the body")).toBe("Absent ankle reflexes on…");
    draw({ run: jamesLive });
    expect(node("fnd-012").textContent).toBe("No foot ulcer");
    expect(node("fnd-008").textContent).toBe("No weight loss");
  });

  it("an uncertain finding is drawn with a dashed outline and a '?' label", () => {
    const run = structuredClone(jamesLive);
    run.output!.findings.find((f) => f.finding_id === "fnd-003")!.assertion = "uncertain";
    draw({ run });
    expect(node("fnd-003").querySelector("circle[stroke-dasharray]")).not.toBeNull();
    expect(node("fnd-003").querySelector("[data-label] tspan")!.textContent).toBe("Type 2 diabetes?");
  });

  it("phone: a finding with no body system is named by its label, not 'Other'", () => {
    draw({ run: jamesLive, narrow: true });
    expect(node("fnd-003").textContent).toContain("Type 2 diabetes");
    expect(node("fnd-003").textContent).not.toContain("Other");
  });

  it.each([
    [false, "sarah live"], [true, "sarah live"], [false, "james live"], [true, "james live"],
  ] as const)("live runs at rest: no label overlaps and ≤ 70 words (narrow: %s, %s)", (narrow, name) => {
    const { container } = draw({ narrow, run: RUNS[name] });
    expect(overlapping(labelRects(1))).toEqual([]);
    expect(visibleWords(container)).toBeLessThanOrEqual(70);
  });

  it("hub names fit inside the hub at the largest size up to 20px", () => {
    expect(hubName("Fabry disease", 50, false)).toEqual({ lines: ["Fabry", "disease"], size: 20 });
    const separate = hubName("Separate common conditions", 50, false);
    expect(separate.lines).toEqual(["Separate", "common", "conditions"]);
    expect(separate.size).toBeGreaterThanOrEqual(13);
    expect(hubName("Separate common conditions", 40, true).lines).toEqual(["Separate?"]);
  });

  it("narrow labels shorten to one word", () => {
    const { container } = draw({ narrow: true });
    for (const text of ["Nerves", "Skin", "Gut", "Kidney", "Eye", "Family", "Celiac serology negative", "No diabetes", "Fabry?", "Separate?", "open · 7", "open · 2", "2016", "prior test", "GLA", "Cause"])
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    expect(screen.getAllByText("missing?")).toHaveLength(2);
    expect(container.textContent).not.toContain("Burning");
  });

  it("narrow: every node and hub has a transparent hit circle of r ≥ 24; desktop has none", () => {
    const { layout } = draw({ narrow: true });
    for (const c of circlesOf(layout)) {
      const hit = node(c.id).querySelector("[data-hit]")!;
      expect(hit.getAttribute("fill")).toBe("transparent");
      expect(Number(hit.getAttribute("r"))).toBe(Math.max(c.r, 24));
    }
    document.body.innerHTML = "";
    draw();
    expect(document.querySelectorAll("[data-hit]")).toHaveLength(0);
  });

  it("zoom > 1.6 adds quote snippets; zoom < 0.8 hides finding labels", () => {
    const { rerender, layout, onSelect } = draw();
    const props = { run: fixtureRun, layout, selectedId: null, onSelect };
    expect(screen.queryAllByTestId("finding-detail")).toHaveLength(0);

    rerender(<Constellation {...props} zoomScale={2} />);
    const details = screen.getAllByTestId("finding-detail");
    expect(details).toHaveLength(7);
    expect(node("fnd-limb-pain").querySelector("[data-testid=finding-detail]")!.textContent).toBe(
      "primary care · “burning pain in her hands and feet since…”",
    );

    rerender(<Constellation {...props} zoomScale={0.6} />);
    expect(screen.queryByText("Rarely sweats")).toBeNull();
    expect(screen.queryByText("2012")).toBeNull();
    expect(screen.queryByText("GLA gene molecular")).toBeNull();
    expect(screen.queryByText("open · 7 findings")).toBeNull();
    expect(screen.getByText("Fabry")).toBeInTheDocument();
    expect(screen.queryAllByTestId("finding-detail")).toHaveLength(0);
  });

  it.each([
    [false, 1], [false, 1.4], [false, 1.96], [false, 2.744], [false, 4],
    [true, 1], [true, 1.4], [true, 1.96], [true, 2.744], [true, 4],
  ])("no two label blocks intersect (narrow: %s, zoom %s)", (narrow, k) => {
    const run = fixtureRun;
    const layout = layoutConstellation(run, { narrow });
    render(<Constellation run={run} layout={layout} selectedId={null} onSelect={vi.fn()} zoomScale={k} transform={{ x: 0, y: 0, k }} />);
    expect(overlapping(labelRects(k))).toEqual([]);
    if (k > 1.6 && !narrow) expect(screen.queryAllByTestId("finding-detail").length).toBeGreaterThan(0);
  });

  it("truncates long labels to 28 chars + …", () => {
    expect(truncate("x".repeat(200))).toBe("x".repeat(28) + "…");
  });

  it("truncate cuts at a word boundary, trims trailing punctuation, keeps short labels", () => {
    expect(truncate("Burning pain in hands and feet since adolescence")).toBe("Burning pain in hands and…");
    expect(truncate("Father on dialysis from age 48, cause unknown", 31)).toBe("Father on dialysis from age 48…");
    expect(truncate("Rarely sweats")).toBe("Rarely sweats");
    expect(truncate("x".repeat(28))).toBe("x".repeat(28));
  });

  it("a 200-char finding label is truncated on the canvas and kept whole in its name", () => {
    const run = structuredClone(fixtureRun);
    const long = "Episodic burning pain ".repeat(10).trim();
    run.output!.findings.find((f) => f.finding_id === "fnd-proteinuria")!.label = long;
    draw({ run });
    const label = node("fnd-proteinuria").querySelector("[data-label] tspan")!.textContent!;
    expect(label.length).toBeLessThanOrEqual(29);
    expect(label.endsWith("…")).toBe(true);
    expect(node("fnd-proteinuria")).toHaveAccessibleName(long);
  });

  it("never renders the word diagnosis outside data-quote text", () => {
    const { container, rerender, layout, onSelect } = draw();
    expect(container.textContent).not.toMatch(/diagnosis/i);
    rerender(<Constellation run={fixtureRun} layout={layout} selectedId={null} onSelect={onSelect} zoomScale={2} />);
    const copy = container.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[data-quote]").forEach((q) => q.remove());
    expect(copy.textContent).not.toMatch(/diagnosis/i);
  });

  it.each([false, true])("edges start and end outside the circles they join (narrow: %s)", (narrow) => {
    const { layout } = draw({ narrow });
    const byId = new Map(circlesOf(layout).map((c) => [c.id, c]));
    for (const e of layout.edges) {
      const d = edge(e.id).getAttribute("d")!;
      expect(d).toBe(e.d);
      const [start, end] = endpoints(d);
      for (const [p, c] of [[start, byId.get(e.from)!], [end, byId.get(e.to)!]] as const)
        expect(Math.hypot(p.x - c.x, p.y - c.y), e.id).toBeGreaterThanOrEqual(c.r + 3.5);
    }
  });

  it("hover or focus dims every node and edge not connected to the node", async () => {
    draw();
    const user = userEvent.setup();
    await user.hover(node("fnd-proteinuria"));
    expect(node("fnd-proteinuria")).not.toHaveAttribute("data-dim");
    expect(node("hyp-fabry")).not.toHaveAttribute("data-dim");
    expect(edge("fnd-proteinuria--supports--hyp-fabry")).not.toHaveAttribute("data-dim");
    expect(node("fnd-limb-pain")).toHaveAttribute("data-dim", "true");
    expect(node("hyp-separate-conditions")).toHaveAttribute("data-dim", "true");
    expect(edge("fnd-limb-pain--supports--hyp-fabry")).toHaveAttribute("data-dim", "true");

    await user.unhover(node("fnd-proteinuria"));
    expect(document.querySelectorAll("[data-dim]").length).toBeGreaterThan(0);
    await waitFor(() => expect(document.querySelectorAll("[data-dim]")).toHaveLength(0));

    fireEvent.focus(node("mis-gla-report"));
    expect(node("hyp-separate-conditions")).not.toHaveAttribute("data-dim");
    expect(node("fnd-proteinuria")).toHaveAttribute("data-dim", "true");
    fireEvent.blur(node("mis-gla-report"));
    expect(document.querySelectorAll("[data-dim]")).toHaveLength(0);
  });

  it("marks the hovered node and lights the edges touching it", async () => {
    draw();
    const user = userEvent.setup();
    await user.hover(node("fnd-proteinuria"));
    expect(node("fnd-proteinuria")).toHaveAttribute("data-hover");
    expect(node("hyp-fabry")).not.toHaveAttribute("data-hover");
    expect(edge("fnd-proteinuria--supports--hyp-fabry")).toHaveAttribute("data-lit");
    expect(edge("fnd-limb-pain--supports--hyp-fabry")).not.toHaveAttribute("data-lit");
    await user.unhover(node("fnd-proteinuria"));
    await waitFor(() => expect(document.querySelectorAll("[data-lit], [data-hover]")).toHaveLength(0));
  });

  it("moving straight from one node to another never clears the dim, and shows the new node's connections", () => {
    vi.useFakeTimers();
    try {
      draw();
      fireEvent.pointerEnter(node("fnd-proteinuria"), { pointerType: "mouse", buttons: 0 });
      fireEvent.pointerLeave(node("fnd-proteinuria"), { pointerType: "mouse" });
      act(() => {
        vi.advanceTimersByTime(99);
      });
      expect(document.querySelectorAll("[data-dim]").length).toBeGreaterThan(0);
      fireEvent.pointerEnter(node("hyp-separate-conditions"), { pointerType: "mouse", buttons: 0 });
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(node("hyp-separate-conditions")).not.toHaveAttribute("data-dim");
      expect(node("fnd-proteinuria")).toHaveAttribute("data-dim", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a pointer entering with a button held (a drag) sets no hover", () => {
    draw();
    fireEvent.pointerEnter(node("fnd-proteinuria"), { pointerType: "mouse", buttons: 1 });
    expect(document.querySelectorAll("[data-dim], [data-hover]")).toHaveLength(0);
  });

  it("a node grows to 85% of the hub radius and its label slides clear of the hover ring; a hub does not grow", () => {
    const { layout } = draw();
    const hubR = Math.max(...layout.hubs.map((h) => h.r)) * 0.85;
    const n = layout.nodes.find((x) => x.id === "fnd-proteinuria")!;
    const style = node(n.id).style;
    expect(Number(style.getPropertyValue("--grow-s"))).toBeCloseTo(hubR / n.r);
    const ring = (hubR + 6) / (n.r + 6);
    expect(Number(style.getPropertyValue("--ring-s"))).toBeCloseTo(ring);
    // Growth, plus the ring's 6-unit offset, plus half its scaled 2px stroke.
    const slide = hubR - n.r + 6 + ring;
    const x = parseFloat(style.getPropertyValue("--lab-x"));
    const y = parseFloat(style.getPropertyValue("--lab-y"));
    const anchor = node(n.id).querySelector("[data-label]")!.getAttribute("text-anchor");
    if (anchor === "end") expect([x, y]).toEqual([-slide, 0]);
    else if (anchor === "start") expect([x, y]).toEqual([slide, 0]);
    else expect([x, Math.abs(y)]).toEqual([0, slide]);
    const hub = layout.hubs[0];
    expect(node(hub.id).style.getPropertyValue("--grow-s")).toBe("1");
    expect(node(hub.id).style.getPropertyValue("--lab-x")).toBe("0px");
  });

  it("shows the empty message when there are no open questions", () => {
    const run = structuredClone(fixtureRun);
    run.output!.hypotheses.forEach((h) => { h.status = "excluded"; });
    draw({ run });
    expect(screen.queryAllByTestId("hub")).toHaveLength(0);
    expect(screen.getByText("No open questions in this run")).toBeInTheDocument();
  });

  it("keeps every transition and animation inside the reduced-motion guard", () => {
    const css = readFileSync(resolve("components/constellation/constellation.css"), "utf8");
    const guard = "@media (prefers-reduced-motion: no-preference)";
    const start = css.indexOf(guard);
    expect(start).toBeGreaterThan(-1);
    let end = css.indexOf("{", start) + 1;
    for (let depth = 1; depth > 0; end++) depth += css[end] === "{" ? 1 : css[end] === "}" ? -1 : 0;
    const inside = css.slice(start, end);
    expect(css.slice(0, start) + css.slice(end)).not.toMatch(/transition|animation|@keyframes/);
    expect(inside).toMatch(/transition: opacity 260ms ease, stroke-width 260ms ease/);
    expect(inside).toMatch(/animation-delay: calc\(var\(--i\) \* 40ms\)/);
  });
});
