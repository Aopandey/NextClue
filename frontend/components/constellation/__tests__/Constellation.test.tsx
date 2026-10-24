import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import fixtureJson from "@/fixtures/sarah-001.run.json";
import type { AnalysisRun } from "@/lib/contracts";
import { layoutConstellation, type Layout } from "@/lib/constellation/layout";
import { Constellation, truncate } from "../Constellation";
import { hubName } from "../Hub";

const fixtureRun = fixtureJson as AnalysisRun;

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

describe("Constellation", () => {
  it("renders 2 hubs, 12 graph nodes + 2 negatives, 13 edges for Sarah", () => {
    draw();
    expect(screen.getAllByTestId("hub")).toHaveLength(2);
    expect(document.querySelectorAll("[data-node-id]")).toHaveLength(14);
    expect(document.querySelectorAll("[data-edge-id]")).toHaveLength(13);
  });

  it("is a labelled SVG sized by the layout view", () => {
    const { container } = draw();
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 1200 760");
    expect(svg).toHaveAccessibleName("Clue constellation");
    draw({ narrow: true });
    expect(document.querySelectorAll("svg")[1].getAttribute("viewBox")).toBe("0 0 400 720");
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

  it("shows no CHECK FIRST when the priority-1 item needs no check", () => {
    const run = structuredClone(fixtureRun);
    run.output!.missing_evidence.forEach((m) => { m.check_existing_first = false; });
    draw({ run });
    expect(screen.queryByText("CHECK FIRST")).toBeNull();
  });

  it.each([false, true])("CHECK FIRST box clears every node and hub circle (narrow: %s)", (narrow) => {
    const { layout } = draw({ narrow });
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
      "No celiac", "No diabetes",
      "2016 test · normal", "not conclusive",
      "GLA gene molecular", "Cause of father's", "open · 7 findings", "open · 2 findings",
    ])
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    expect(node("fnd-celiac-negative").textContent).not.toMatch(/\d{4}/);
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
    for (const text of ["Nerves", "Skin", "Gut", "Kidney", "Eye", "Family", "No celiac", "No diabetes", "Fabry?", "Separate?", "open · 7", "open · 2", "2016", "not conclusive", "GLA", "Cause"])
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
    expect(document.querySelectorAll("[data-dim]")).toHaveLength(0);

    fireEvent.focus(node("mis-gla-report"));
    expect(node("hyp-separate-conditions")).not.toHaveAttribute("data-dim");
    expect(node("fnd-proteinuria")).toHaveAttribute("data-dim", "true");
    fireEvent.blur(node("mis-gla-report"));
    expect(document.querySelectorAll("[data-dim]")).toHaveLength(0);
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
    expect(inside).toMatch(/transition: opacity 150ms/);
    expect(inside).toMatch(/animation-delay: calc\(var\(--i\) \* 40ms\)/);
  });
});
