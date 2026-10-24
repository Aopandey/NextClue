import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const css = readFileSync("app/globals.css", "utf8");
describe("design tokens", () => {
  it.each([
    ["--bg", "#fbf8f2"], ["--ink", "#24211c"], ["--sig", "#d4520c"], ["--nerve", "#6d4aa8"],
    ["--sweat", "#0d7c80"], ["--gut", "#a0700a"], ["--kidney", "#a8385f"], ["--eye", "#2c63b2"],
    ["--family", "#4b7b2c"], ["--blood", "#5d6a7a"], ["--other", "#8a8378"],
  ])("%s is %s", (name, hex) => expect(css).toContain(`${name}:${hex}`));
  it("bans generic AI fonts", () => expect(css).not.toMatch(/Inter|Lexend|Poppins|DM Sans|Space Grotesk|Plus Jakarta/));
});
