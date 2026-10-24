import type { CSSProperties } from "react";

type Props = { onZoomIn: () => void; onZoomOut: () => void; onFit: () => void };

const button: CSSProperties = {
  width: 40,
  height: 40,
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--ink)",
  font: "inherit",
  fontSize: 16,
  cursor: "pointer",
  boxShadow: "none",
};

const bar: CSSProperties = { position: "absolute", right: 12, bottom: 12, display: "flex", gap: 6 };

/** Zoom in, zoom out and fit, bottom right of the canvas. */
export function ZoomControls({ onZoomIn, onZoomOut, onFit }: Props) {
  return (
    <div style={bar}>
      <button type="button" aria-label="Zoom in" style={button} onClick={onZoomIn}>+</button>
      <button type="button" aria-label="Zoom out" style={button} onClick={onZoomOut}>−</button>
      <button type="button" aria-label="Fit" style={{ ...button, fontSize: 13 }} onClick={onFit}>Fit</button>
    </div>
  );
}
