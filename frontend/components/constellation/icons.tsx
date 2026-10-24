import type { ReactNode } from "react";
import type { BodySystem } from "@/lib/constellation/systems";

// 24×24 line icons ported from docs/design/constellation/reference.html.
const PATHS = {
  nerve: (
    <>
      <circle cx="7.5" cy="12" r="3" />
      <path d="M5.2 10 3 7M4.5 12H2M5.2 14 3 17M10.5 12H17.5M17.5 12l3.5-3.5M17.5 12H21.5M17.5 12l3.5 3.5" />
    </>
  ),
  drop: (
    <>
      <path d="M12 3.2S6.4 9.6 6.4 14a5.6 5.6 0 0 0 11.2 0C17.6 9.6 12 3.2 12 3.2z" />
      <path d="M9.4 14.6a2.6 2.6 0 0 0 2.2 2.4" />
    </>
  ),
  gut: <path d="M5.5 4.5h9a2.75 2.75 0 0 1 0 5.5h-5a2.75 2.75 0 0 0 0 5.5h5a2.75 2.75 0 0 1 0 5.5H7" />,
  kidney: (
    <>
      <path d="M14.6 4.2C9.6 2.8 5 6.4 5 12s4.6 9.2 9.6 7.8c2.6-.7 3.2-3.4 1.4-5-1.1-1-1.1-4.6 0-5.6 1.8-1.6 1.2-4.3-1.4-5z" />
      <path d="M9.4 8.6c-1.4 2.2-1.4 4.6 0 6.8" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12c3.2-5.6 15.8-5.6 19 0-3.2 5.6-15.8 5.6-19 0z" />
      <circle cx="12" cy="12" r="3.7" />
      <path d="M12 12c.7 0 1-.7.7-1.2-.5-.7-1.8-.5-2 .4-.3 1.1.5 2.2 1.8 2.2 1.6 0 2.5-1.5 2-2.9" />
    </>
  ),
  family: (
    <>
      <rect x="3.5" y="3.5" width="6" height="6" />
      <circle cx="17.5" cy="6.5" r="3" />
      <path d="M9.5 6.5h5M12 6.5v7" />
      <circle cx="12" cy="17" r="3.3" />
    </>
  ),
  vial: <path d="M8.5 3.5h7M10 3.5v13a2 2 0 0 0 4 0v-13M10 11h4" />,
  heart: (
    <>
      <path d="M12 20s-7.5-4.6-7.5-10A4.1 4.1 0 0 1 12 7.6 4.1 4.1 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
      <path d="M6.5 12.5h3l1.3-2.4 2 4.6 1.4-2.2h3.3" />
    </>
  ),
  lung: (
    <>
      <path d="M12 3.5v8M12 11.5l-2.2 2M12 11.5l2.2 2" />
      <path d="M9.8 8.2C6.6 7 4.2 11 4.2 16v1.6c0 1.4 1.2 2.2 2.6 1.7l3-1.2V8.2zM14.2 8.2c3.2-1.2 5.6 2.8 5.6 7.8v1.6c0 1.4-1.2 2.2-2.6 1.7l-3-1.2V8.2z" />
    </>
  ),
  bone: (
    <>
      <path d="M8.6 15.4l6.8-6.8" />
      <circle cx="6.4" cy="15.2" r="2" />
      <circle cx="8.8" cy="17.6" r="2" />
      <circle cx="15.2" cy="6.4" r="2" />
      <circle cx="17.6" cy="8.8" r="2" />
    </>
  ),
  doc: (
    <>
      <path d="M6.5 3h7.5l4 4v14h-11.5z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 12h5M9.5 15h5M9.5 18h3" />
    </>
  ),
  ask: (
    <>
      <path d="M9.4 9.3a2.7 2.7 0 1 1 3.8 2.5c-.9.4-1.2 1-1.2 1.8v.7" />
      <path d="M12 17.4v.2" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** `other` has no icon: its node is a plain disc. */
export const SYSTEM_ICON: Record<BodySystem, IconName | null> = {
  nerve: "nerve",
  sweat: "drop",
  gut: "gut",
  kidney: "kidney",
  eye: "eye",
  family: "family",
  blood: "vial",
  heart: "heart",
  lung: "lung",
  joint: "bone",
  other: null,
};

/** An icon centred on (0, 0), `size` units across, with a ~1.9-unit stroke at any size. */
export function Icon({ name, size, color, opacity }: { name: IconName; size: number; color: string; opacity?: number }) {
  const s = size / 24;
  return (
    <g
      transform={`scale(${round(s)}) translate(-12 -12)`}
      fill="none"
      stroke={color}
      strokeWidth={round((2 / s) * 0.95)}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      aria-hidden="true"
    >
      {PATHS[name]}
    </g>
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;
