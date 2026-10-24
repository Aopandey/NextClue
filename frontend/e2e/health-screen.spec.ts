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
  await page.getByRole("button", { name: /GLA gene molecular testing report/ }).click();
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
  await page.getByRole("button", { name: /Small fiber neuropathy/ }).waitFor();
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("svg [role=button]")]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { name: el.getAttribute("aria-label"), w: r.width, h: r.height };
      })
      .filter((b) => b.w < 39.5 || b.h < 39.5),
  );
  expect(small).toEqual([]);
});

test("every citation link has a real href and no fake PMID", async ({ page }) => {
  await page.goto(PATH);
  await page.getByRole("button", { name: /Fabry/ }).first().click();
  await page.getByText("More about this disease").click();
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
