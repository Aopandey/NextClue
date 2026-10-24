"use client";

import { useMemo, useRef, type MouseEvent } from "react";
import type { AnalysisRun } from "@/lib/contracts";
import { layoutConstellation } from "@/lib/constellation/layout";
import { Constellation } from "./Constellation";
import { useZoom } from "./useZoom";
import { ZoomControls } from "./ZoomControls";

type Props = { run: AnalysisRun; selectedId: string | null; onSelect: (id: string) => void; narrow?: boolean };

const DOUBLE_CLICK_SCALE = 2;

/** The constellation with pan and zoom: owns the layout and the zoom state. */
export function ConstellationView({ run, selectedId, onSelect, narrow }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const layout = useMemo(() => layoutConstellation(run, { narrow }), [run, narrow]);
  const { transform, scale, zoomIn, zoomOut, fit, zoomTo } = useZoom(svgRef, layout.view);

  const onDoubleClick = (e: MouseEvent) => {
    const id = (e.target as Element).closest("[data-node-id]")?.getAttribute("data-node-id");
    const target = [...layout.nodes, ...layout.hubs].find((n) => n.id === id);
    if (target) zoomTo(target.x, target.y, DOUBLE_CLICK_SCALE);
  };

  return (
    <div style={{ position: "relative" }} onDoubleClick={onDoubleClick}>
      <Constellation
        run={run}
        layout={layout}
        selectedId={selectedId}
        onSelect={onSelect}
        zoomScale={scale}
        transform={transform}
        svgRef={svgRef}
      />
      <ZoomControls onZoomIn={zoomIn} onZoomOut={zoomOut} onFit={fit} below={narrow} />
    </div>
  );
}
