// PreToolUse hook: block a `git commit` that would include a .env file or something that looks like a key.
// Exit 2 blocks the tool and sends stderr to the agent. Only file names and the kind of key are printed,
// never the value. Any other command passes through.
import { execFileSync } from "node:child_process";
import { commandText, readEvent } from "./hook-input.mjs";

const command = commandText(readEvent());
if (!/\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(command)) process.exit(0);

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return "";
  }
};

// This runs before the command, so approximate what the commit will contain: the index, plus tracked
// edits and untracked file names when the same command stages them (`commit -a`, `git add … && commit`).
const addSegments = [...command.matchAll(/\bgit\s+add\b([^;&|\n]*)/g)].map((m) => m[1]);
const alsoWorkingTree = addSegments.length > 0 || /\bcommit\b[^\n]*\s(?:-(?!-)[a-zA-Z]*a[a-zA-Z]*|--all)\b/.test(command);
const lines = (s) => s.split("\n").filter(Boolean);
const names = new Set(lines(git("diff", "--cached", "--name-only")));
let diff = git("diff", "--cached", "-U0", "--no-color");
if (alsoWorkingTree) {
  lines(git("diff", "--name-only")).forEach((n) => names.add(n));
  diff += git("diff", "-U0", "--no-color");
}
if (addSegments.length) lines(git("ls-files", "--others", "--exclude-standard")).forEach((n) => names.add(n));
// Paths named in a `git add` (e.g. `git add -f backend/.env.local`); commit messages are not scanned.
for (const seg of addSegments)
  for (const m of seg.matchAll(/(?:^|[\s"'])((?:[\w.-]+\/)*\.env(?:\.[\w-]+)?)(?=$|[\s"'])/g)) names.add(m[1]);

const problems = [];
for (const name of names) {
  const base = name.split("/").pop();
  if (/^\.env(\..+)?$/.test(base) && base !== ".env.example") problems.push(`${name}: environment file`);
}

const KEY_PATTERNS = [
  ["Google/Gemini API key", /AIza[0-9A-Za-z_-]{35}/],
  ["OpenAI-style secret key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["JWT (e.g. Supabase service-role key)", /eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["secret assignment", /\b[A-Z0-9_]*(?:SERVICE_ROLE_KEY|API_KEY|SECRET|TOKEN|PASSWORD)\s*[=:]\s*["']?(?!your|<|\$\{|xxx|changeme|example|process\.env|os\.environ|import\.meta|env\.|settings\.)[A-Za-z0-9_\-./+]{16,}/],
];

let file = null;
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ ")) {
    file = line.replace(/^\+\+\+ (b\/)?/, "");
    continue;
  }
  if (!line.startsWith("+") || file === null || file.endsWith(".env.example")) continue;
  for (const [kind, re] of KEY_PATTERNS) {
    if (re.test(line)) {
      problems.push(`${file}: looks like a ${kind}`);
      break;
    }
  }
}

if (problems.length) {
  const unique = [...new Set(problems)];
  process.stderr.write(
    `Commit blocked by .kiro/hooks/block-secrets.json — it would include secrets:\n- ${unique.join("\n- ")}\n` +
      "Unstage these (git restore --staged <file>), keep keys in ignored .env files, then commit again. " +
      "If this is a false positive, tell Mike and let him commit.\n",
  );
  process.exit(2);
}
process.exit(0);
