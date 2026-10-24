// SessionStart hook: if a subagent-driven-development ledger exists for the current branch, put its tail
// into the new session's context so a fresh agent resumes from it. Prints nothing when there is no ledger.
// Ledgers live in the main checkout's git-ignored .superpowers/sdd/<plan>/progress.md.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};

const branch = git("branch", "--show-current");
if (!branch) process.exit(0);
const top = git("rev-parse", "--show-toplevel");
const commonDir = git("rev-parse", "--path-format=absolute", "--git-common-dir");
const roots = [...new Set([top, commonDir ? dirname(resolve(commonDir)) : ""].filter(Boolean))];

const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const belongs = new RegExp(`^Branch: ${escaped}\\b|Worktree \`${escaped}\``, "m");

const ledgers = [];
for (const root of roots) {
  const dir = join(root, ".superpowers", "sdd");
  if (!existsSync(dir)) continue;
  for (const plan of readdirSync(dir)) {
    const file = join(dir, plan, "progress.md");
    if (existsSync(file) && belongs.test(readFileSync(file, "utf8"))) ledgers.push(file);
  }
}
if (!ledgers.length) process.exit(0);

const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const out = [`SDD ledger for branch \`${branch}\` — read it in full before continuing work:`];
for (const file of [...new Set(ledgers)]) {
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
  const tail = lines.slice(-6);
  // A HANDOFF note is shown only while it is recent; once work has moved on, the latest entries are the truth.
  const at = lines.findLastIndex((l) => /HANDOFF/.test(l));
  const handoff = at >= 0 && at >= lines.length - 15 ? lines[at] : null;
  out.push(`- ${relative(top, file) || file}`);
  if (handoff && !tail.includes(handoff)) out.push(`  last handoff: ${clip(handoff, 300)}`);
  out.push("  latest entries:", ...tail.map((l) => `  ${clip(l, 240)}`));
}
const dirty = git("status", "--porcelain").split("\n").filter((l) => l && !l.startsWith("??")).length;
out.push(`HEAD: ${git("log", "-1", "--oneline")}${dirty ? ` · ${dirty} uncommitted tracked change(s) — may belong to another active session` : ""}`);
process.stdout.write(`${out.join("\n")}\n`);
process.exit(0);
