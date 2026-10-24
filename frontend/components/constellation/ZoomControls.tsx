import type { CSSProperties } from "react";

type Props = { onZoomIn: () => void; onZoomOut: () => void; onFit: () => void; below?: boolean };

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

const barBelow: CSSProperties = { display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8 };

/** Zoom in, zoom out and fit: over the canvas's bottom right, or `below` it (phone: Check first sits there). */
export function ZoomControls({ onZoomIn, onZoomOut, onFit, below }: Props) {
  return (
    <div style={below ? barBelow : bar}>
      <button type="button" aria-label="Zoom in" style={button} onClick={onZoomIn}>+</button>
      <button type="button" aria-label="Zoom out" style={button} onClick={onZoomOut}>−</button>
      <button type="button" aria-label="Fit" style={{ ...button, fontSize: 13 }} onClick={onFit}>Fit</button>
    </div>
  );
}
