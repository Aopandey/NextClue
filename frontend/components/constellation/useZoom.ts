"use client";

import { select } from "d3-selection";
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export const SCALE_EXTENT: [number, number] = [0.5, 4];
const STEP = 1.4;
const DURATION_MS = 200;

const clamp = (k: number) => Math.min(SCALE_EXTENT[1], Math.max(SCALE_EXTENT[0], k));
const ease = (t: number) => 1 - (1 - t) ** 3;

function prefersReducedMotion() {
  return typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type ZoomApi = {
  transform: ZoomTransform;
  scale: number;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  /** Centre the view on (x, y) in view units at scale k (default: the current scale). */
  zoomTo(x: number, y: number, k?: number): void;
};

/**
 * d3-zoom on the svg (wheel, drag, pinch), exposed as React state. `view` is the svg's viewBox size; it is
 * passed as the zoom extent because jsdom has no `viewBox.baseVal`. Button zooms ease over 200ms, or jump
 * under reduced motion. Double-click zoom is off: the owner decides what a double-click means.
 */
export function useZoom(svgRef: RefObject<SVGSVGElement | null>, view: { w: number; h: number }): ZoomApi {
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const behavior = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent(SCALE_EXTENT)
      .extent([[0, 0], [view.w, view.h]])
      .on("zoom", (e) => setTransform(e.transform));
    behavior.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    return () => {
      cancelAnimationFrame(frame.current);
      select(svg).on(".zoom", null);
      behavior.current = null;
    };
  }, [svgRef, view.w, view.h]);

  const goTo = useCallback(
    (target: ZoomTransform) => {
      const svg = svgRef.current;
      const z = behavior.current;
      if (!svg || !z) return;
      cancelAnimationFrame(frame.current);
      const sel = select(svg);
      if (prefersReducedMotion()) {
        sel.call(z.transform, target);
        return;
      }
      const from = zoomTransform(svg);
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION_MS);
        const e = ease(t);
        const k = from.k + (target.k - from.k) * e;
        sel.call(z.transform, zoomIdentity.translate(from.x + (target.x - from.x) * e, from.y + (target.y - from.y) * e).scale(k));
        if (t < 1) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [svgRef],
  );

  const about = useCallback(
    (factor: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const cur = zoomTransform(svg);
      const k = clamp(cur.k * factor);
      const [cx, cy] = [view.w / 2, view.h / 2];
      const [px, py] = cur.invert([cx, cy]);
      goTo(zoomIdentity.translate(cx - px * k, cy - py * k).scale(k));
    },
    [svgRef, view.w, view.h, goTo],
  );

  const zoomTo = useCallback(
    (x: number, y: number, k?: number) => {
      const svg = svgRef.current;
      if (!svg) return;
      const kk = clamp(k ?? zoomTransform(svg).k);
      goTo(zoomIdentity.translate(view.w / 2 - x * kk, view.h / 2 - y * kk).scale(kk));
    },
    [svgRef, view.w, view.h, goTo],
  );

  return {
    transform,
    scale: transform.k,
    zoomIn: useCallback(() => about(STEP), [about]),
    zoomOut: useCallback(() => about(1 / STEP), [about]),
    fit: useCallback(() => goTo(zoomIdentity), [goTo]),
    zoomTo,
  };
}
