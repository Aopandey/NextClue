import type { EdgePos } from "@/lib/constellation/layout";

/** One graph edge. `d` comes from the layout, already trimmed outside both circles; it is drawn as-is. */
export function Edge({ edge, color, dim }: { edge: EdgePos; color: string; dim: boolean }) {
  return (
    <path
      data-edge-id={edge.id}
      data-dim={dim || undefined}
      className={`cn-edge cn-edge-${edge.relation}`}
      d={edge.d}
      fill="none"
      stroke={color}
      strokeWidth={edge.width}
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    />
  );
}
