import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sources: Record<string, { pmid: string | number | null }> = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures/sources.json"), "utf8"),
);

const PATH = "/patients/sarah-001";

test("demo path", async ({ page }) => {
  await page.goto(PATH);
  await page.getByRole("button", { name: /Small fiber neuropathy/ }).click();
  await expect(page.getByText(/reduced intraepidermal nerve fiber density/).first()).toBeVisible();
  await page.getByRole("button", { name: /alpha-Gal A enzyme screen/ }).click();
  await expect(page.getByText(/Enzyme activity was not low/).first()).toBeVisible();
  // The node, not the CHECK FIRST box, which is named by the same item.
  await page.getByRole("button", { name: /GLA gene molecular testing report/ }).first().click();
  await expect(page.getByText(/Molecular testing identifies heterozygous females/).first()).toBeVisible();
  await expect(page.getByText(/no report from that visit is in our chart/).first()).toBeVisible();
});

test("no horizontal overflow and no page errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(PATH);
  await page.getByRole("button", { name: /Small fiber neuropathy/ }).waitFor();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(errors).toEqual([]);
});

test("no label overlaps at default zoom", async ({ page }) => {
  await page.goto(PATH);
  await page.getByRole("button", { name: /Small fiber neuropathy/ }).waitFor();
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll("[data-label]")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent?.trim() ?? "", x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
      })
      .filter((b) => b.x1 > b.x0 && b.y1 > b.y0),
  );
  expect(boxes.length).toBeGreaterThan(5);
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) overlaps.push(`${a.text} | ${b.text}`);
    }
  }
  expect(overlaps).toEqual([]);
});

test("visible words in the constellation are at most 70", async ({ page }) => {
  await page.goto(PATH);
  await page.getByRole("button", { name: /Small fiber neuropathy/ }).waitFor();
  const words = await page.evaluate(() => {
    const svg = document.querySelector("svg:has([role=button])");
    const text = [...(svg?.querySelectorAll("text") ?? [])].map((t) => t.textContent ?? "").join(" ");
    return text.split(/\s+/).filter(Boolean).length;
  });
  expect(words).toBeGreaterThan(0);
  expect(words).toBeLessThanOrEqual(70);
});

test("tap targets are at least 40px on phone", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.goto(PATH);
  await page.getByRole("button", { name: /Small fiber neuropathy/ }).click();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  const { checked, small } = await page.evaluate(() => {
    const visible = [...document.querySelectorAll("button, [role=button]")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", w: r.width, h: r.height };
      })
      .filter((b) => b.w > 0 && b.h > 0);
    return { checked: visible.map((b) => b.name), small: visible.filter((b) => b.w < 39.5 || b.h < 39.5) };
  });
  for (const name of ["Zoom in", "Zoom out", "Fit", "Close", "GLA gene molecular testing report"]) expect(checked).toContain(name);
  expect(small).toEqual([]);
});

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

test("desktop: header, whole canvas, zoom controls and disclaimer fit one viewport, panel open or not", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  const outside = () =>
    page.evaluate(() => {
      const els = {
        header: document.querySelector("h1"),
        canvas: document.querySelector("svg:has([role=button])"),
        fit: document.querySelector("button[aria-label=Fit]"),
        disclaimer: document.querySelector("footer"),
      };
      const bad = Object.entries(els)
        .filter(([, el]) => {
          const r = el?.getBoundingClientRect();
          return !r || r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth;
        })
        .map(([k]) => k);
      const doc = document.documentElement;
      if (doc.scrollHeight > doc.clientHeight) bad.push(`scrollHeight ${doc.scrollHeight} > ${doc.clientHeight}`);
      return bad;
    });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(PATH);
    await page.getByRole("button", { name: /Small fiber neuropathy/ }).waitFor();
    expect(await outside(), `${viewport.width}x${viewport.height}`).toEqual([]);
    await page.getByRole("button", { name: /Small fiber neuropathy/ }).click();
    await expect(page.getByRole("complementary", { name: "Detail" })).toBeVisible();
    expect(await outside(), `${viewport.width}x${viewport.height} with panel`).toEqual([]);
  }
});

/** Zoom in twice with the buttons (1.96×, the first step past the 1.6× detail threshold). */
async function zoomInTwice(page: import("@playwright/test").Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PATH);
  await page.getByRole("button", { name: /Small fiber neuropathy/ }).waitFor();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator("[data-zoom-layer]")).toHaveAttribute("transform", /scale\(1\.9[56]/);
}

test("zoomed content is clipped to the canvas", async ({ page }) => {
  await zoomInTwice(page);
  const { escaped, painted } = await page.evaluate(() => {
    const svg = document.querySelector("svg:has([role=button])")!;
    const box = svg.getBoundingClientRect();
    const escaped: string[] = [];
    const painted: string[] = [];
    for (const el of svg.querySelectorAll("[data-node-id]")) {
      const r = el.getBoundingClientRect();
      const [x, y] = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
      const inCanvas = x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      const onScreen = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
      if (inCanvas || !onScreen) continue;
      escaped.push(el.getAttribute("data-node-id")!);
      if (svg.contains(document.elementFromPoint(x, y))) painted.push(el.getAttribute("data-node-id")!);
    }
    return { escaped, painted };
  });
  expect(escaped.length).toBeGreaterThan(0);
  expect(painted).toEqual([]);
});

test("no label overlaps at the first detail zoom", async ({ page }, info) => {
  await zoomInTwice(page);
  // Every label of the zoomed graph, including those panned outside the canvas (a pan brings them in).
  // CHECK FIRST is a fixed overlay outside the graph; zoomed content passes under it.
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll("svg [data-node-id] [data-label]")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { text: el.textContent?.trim() ?? "", x0: r.left, y0: r.top, x1: r.right, y1: r.bottom };
      })
      .filter((b) => b.x1 > b.x0 && b.y1 > b.y0),
  );
  expect(boxes.length).toBeGreaterThan(5);
  if (info.project.name === "desktop") await expect(page.getByTestId("finding-detail").first()).toBeAttached();
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) overlaps.push(`${a.text} | ${b.text}`);
    }
  expect(overlaps).toEqual([]);
});

test("disclosures show a chevron and open from the keyboard", async ({ page }) => {
  await page.goto(PATH);
  await page.getByRole("button", { name: /Fabry/ }).first().click();
  const summary = page.locator("summary", { hasText: "Supporting claims" });
  const details = summary.locator("xpath=..");
  const chevron = () => summary.evaluate((el) => getComputedStyle(el, "::after").transform);
  await expect(details).not.toHaveAttribute("open", "");
  const closed = await chevron();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
  await expect.poll(chevron).not.toBe(closed);
});

test("every citation link has a real href and no fake PMID", async ({ page }) => {
  await page.goto(PATH);
  await page.getByRole("button", { name: /Fabry/ }).first().click();
  await page.locator("summary", { hasText: "Supporting claims" }).click();
  const links = await page.evaluate(() =>
    [...document.querySelectorAll("details a[href]")].map((a) => ({
      href: a.getAttribute("href") ?? "",
      text: a.textContent ?? "",
    })),
  );
  expect(links.length).toBeGreaterThan(0);
  for (const l of links) expect(l.href).toMatch(/^https:\/\//);
  const pmids = new Set(
    Object.values(sources)
      .map((x) => x.pmid)
      .filter((x) => x != null)
      .map(String),
  );
  for (const l of links) {
    const m = l.href.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/);
    if (m) expect(pmids.has(m[1])).toBe(true);
  }
});
