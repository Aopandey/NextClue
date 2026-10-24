// Shared helper for the repo's Kiro hooks: read the hook event from stdin and pull out the shell command.
// The docs show PreToolUse payloads as { hook_event_name, cwd, session_id, tool_name, tool_input }, but do
// not pin the key that holds the shell command, so every string inside tool_input is joined and searched.
import { readFileSync } from "node:fs";

export function readEvent() {
  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return { raw: "", event: null };
  }
  try {
    return { raw, event: JSON.parse(raw) };
  } catch {
    return { raw, event: null };
  }
}

/** All string values under `tool_input` (falling back to the raw stdin text), joined by newlines. */
export function commandText({ raw, event }) {
  const input = event && typeof event === "object" ? event.tool_input : undefined;
  if (input === undefined) return raw;
  const parts = [];
  const walk = (v) => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(input);
  return parts.join("\n");
}
