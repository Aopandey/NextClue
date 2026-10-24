"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 639px)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const snapshot = () => window.matchMedia(QUERY).matches;

/** True on phones (< 640px). False on the server and where matchMedia is absent. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? subscribe : () => () => {},
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? snapshot() : false),
    () => false,
  );
}
