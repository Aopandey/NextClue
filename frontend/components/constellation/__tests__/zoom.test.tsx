import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import fixtureJson from "@/fixtures/sarah-001.run.json";
import type { AnalysisRun } from "@/lib/contracts";
import { layoutConstellation } from "@/lib/constellation/layout";
import { ConstellationView } from "../ConstellationView";
import { allowGesture } from "../useZoom";

const run = fixtureJson as AnalysisRun;

function setup(props: { narrow?: boolean } = {}) {
  const onSelect = vi.fn();
  const user = userEvent.setup();
  const utils = render(<ConstellationView run={run} selectedId={null} onSelect={onSelect} {...props} />);
  return { ...utils, user, onSelect };
}

const layer = () => document.querySelector<SVGGElement>("[data-zoom-layer]")!;
const transform = () => {
  const m = layer().getAttribute("transform")!.match(/translate\(([-\d.e]+)[ ,]+([-\d.e]+)\) scale\(([-\d.e]+)\)/)!;
  return { x: Number(m[1]), y: Number(m[2]), k: Number(m[3]) };
};
const scale = () => transform().k;
const click = (name: string) => userEvent.click(screen.getByRole("button", { name }));

describe("ConstellationView zoom", () => {
  it("zoom in/out/fit change scale within [0.5, 4]", async () => {
    setup();
    expect(scale()).toBe(1);
    await click("Zoom in");
    expect(scale()).toBeCloseTo(1.4);
    for (let i = 0; i < 10; i++) await click("Zoom in");
    expect(scale()).toBe(4);
    for (let i = 0; i < 20; i++) await click("Zoom out");
    expect(scale()).toBe(0.5);
    await click("Fit");
    expect(transform()).toEqual({ x: 0, y: 0, k: 1 });
  });

  it("zooming by buttons keeps the view centre fixed", async () => {
    const layout = layoutConstellation(run);
    setup();
    await click("Zoom in");
    const t = transform();
    expect(t.x + t.k * (layout.view.w / 2)).toBeCloseTo(layout.view.w / 2);
    expect(t.y + t.k * (layout.view.h / 2)).toBeCloseTo(layout.view.h / 2);
  });

  it("scale > 1.6 shows the 7 finding detail lines; they are hidden at rest", async () => {
    setup();
    expect(screen.queryAllByTestId("finding-detail")).toHaveLength(0);
    await click("Zoom in");
    expect(screen.queryAllByTestId("finding-detail")).toHaveLength(0);
    await click("Zoom in");
    expect(screen.getAllByTestId("finding-detail")).toHaveLength(7);
  });

  it("below 0.8 labels are hidden", async () => {
    setup();
    const atRest = document.querySelectorAll("[data-label]").length;
    await click("Zoom out");
    await click("Zoom out");
    expect(scale()).toBeLessThan(0.8);
    // Hub names and the Check first marker stay; every node label goes.
    expect(document.querySelectorAll("[data-label]").length).toBeLessThan(atRest);
    expect(document.querySelectorAll("[data-node-id]:not([data-testid=hub]) [data-label]")).toHaveLength(0);
  });

  it("the zoom layer holds all drawn nodes, edges and hubs", async () => {
    setup();
    expect(layer().querySelectorAll("[data-node-id]")).toHaveLength(14);
    expect(layer().querySelectorAll("[data-edge-id]")).toHaveLength(13);
    expect(layer().querySelectorAll("[data-testid=hub]")).toHaveLength(2);
  });

  it("double-clicking a node centres it at 2x", async () => {
    const layout = layoutConstellation(run);
    const target = layout.nodes[0];
    setup();
    fireEvent.doubleClick(document.querySelector(`[data-node-id="${target.id}"]`)!);
    const t = transform();
    expect(t.k).toBe(2);
    expect(t.x + 2 * target.x).toBeCloseTo(layout.view.w / 2);
    expect(t.y + 2 * target.y).toBeCloseTo(layout.view.h / 2);
  });

  it("double-clicking empty canvas does not zoom", () => {
    setup();
    fireEvent.doubleClick(document.querySelector("svg")!);
    expect(scale()).toBe(1);
  });

  it("selecting a node still works", async () => {
    const { onSelect } = setup();
    const id = layoutConstellation(run).nodes[0].id;
    // fireEvent: user-event's mousedown carries no `view`, which d3-drag's mousedown handler needs.
    fireEvent.click(document.querySelector(`[data-node-id="${id}"]`)!);
    expect(onSelect).toHaveBeenCalledWith(id);
  });

  it("controls are three 40px buttons named Zoom in, Zoom out, Fit", () => {
    setup();
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names.filter((n) => ["Zoom in", "Zoom out", "Fit"].includes(n!))).toEqual(["Zoom in", "Zoom out", "Fit"]);
    for (const n of ["Zoom in", "Zoom out", "Fit"]) {
      const style = screen.getByRole("button", { name: n }).style;
      expect(style.width).toBe("40px");
      expect(style.height).toBe("40px");
    }
  });

  it("uses the narrow layout when asked", () => {
    const { container } = setup({ narrow: true });
    expect(container.querySelector("svg")!.getAttribute("viewBox")).toBe("0 0 400 720");
  });
});

describe("page scroll vs zoom gestures", () => {
  const ev = (type: string, init: Record<string, unknown> = {}) => Object.assign(new Event(type), init);
  it("wheel zooms only with Ctrl or Meta", () => {
    expect(allowGesture(ev("wheel"))).toBe(false);
    expect(allowGesture(ev("wheel", { ctrlKey: true }))).toBe(true);
    expect(allowGesture(ev("wheel", { metaKey: true }))).toBe(true);
  });
  it("touch needs two fingers", () => {
    expect(allowGesture(ev("touchstart", { touches: [{}] }))).toBe(false);
    expect(allowGesture(ev("touchmove", { touches: [{}, {}] }))).toBe(true);
  });
  it("mouse drag pans; secondary button does not", () => {
    expect(allowGesture(ev("mousedown", { button: 0 }))).toBe(true);
    expect(allowGesture(ev("mousedown", { button: 2 }))).toBe(false);
  });
});
