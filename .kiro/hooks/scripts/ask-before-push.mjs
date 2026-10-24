// PreToolUse hook: make Kiro ask Mike before any push or merge.
// Prints a permissionDecision "ask" on stdout and exits 0; any other command passes through silently.
import { commandText, readEvent } from "./hook-input.mjs";

const PUSH_OR_MERGE = /\bgit\s+(?:-C\s+\S+\s+)?(push|merge)\b|\bgh\s+pr\s+merge\b/;

const command = commandText(readEvent());
const match = command.match(PUSH_OR_MERGE);
if (match) {
  const what = match[1] ?? "pr merge";
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        permissionDecision: "ask",
        permissionDecisionReason: `Mike's rule: never ${what === "push" ? "push" : "merge"} without asking first.`,
      },
    }),
  );
}
process.exit(0);
