import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("landing to graph and back", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Scattered records, one handoff." })).toBeVisible();
  await expect(page.getByText("Offline sample")).toBeVisible();
  await page.getByRole("link", { name: /^Sarah, .*open graph$/ }).click();
  await expect(page).toHaveURL(/\/patients\/sarah-001$/);
  await expect(page.getByRole("button", { name: /Small fiber neuropathy/ })).toBeVisible();
  await page.getByRole("link", { name: "← Patients" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("layout: no overflow, no clipped illustration labels, tap targets, no page errors", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const row = page.getByRole("link", { name: /^Sarah, .*open graph$/ });
  await row.waitFor();
  // Details fill in after the list; wait so the measurements and screenshot are of the settled page.
  await expect(row.getByText(/\d+ records?/)).toBeVisible();

  const overflow = await page.evaluate(() => {
    const edge = document.documentElement.clientWidth;
    return {
      page: document.documentElement.scrollWidth - edge,
      elements: [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > edge + 0.5)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "").slice(0, 40)}`),
    };
  });
  expect(overflow).toEqual({ page: 0, elements: [] });

  const labels = await page.evaluate(() => {
    const svg = document.querySelector("svg[role=img]")!;
    const box = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll("text")];
    const outside = texts
      .filter((t) => {
        const r = t.getBoundingClientRect();
        return r.left < box.left - 0.5 || r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5;
      })
      .map((t) => t.textContent);
    return { count: texts.length, outside };
  });
  expect(labels.count).toBeGreaterThan(0);
  expect(labels.outside).toEqual([]);

  if (testInfo.project.name === "phone") {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }

  expect(errors).toEqual([]);

  mkdirSync(join(process.cwd(), "test-results"), { recursive: true });
  await page.screenshot({ path: join(process.cwd(), "test-results", `landing-${testInfo.project.name}.png`), fullPage: true });
});
