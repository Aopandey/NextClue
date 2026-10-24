import type { CSSProperties, ReactNode } from "react";
import type { Finding, MissingEvidence } from "@/lib/contracts";
import type { NodePos } from "@/lib/constellation/layout";
import { SYSTEM_LABEL } from "@/lib/constellation/systems";
import { Icon, SYSTEM_ICON } from "./icons";

export type ZoomLevel = "icons" | "labels" | "detail";
/** Zoom past which findings add their detail line. */
export const DETAIL_SCALE = 1.6;
/** Semantic zoom: > 1.6 adds finding detail, < 0.8 hides every label but hub names. */
export const zoomLevel = (scale: number): ZoomLevel => (scale > DETAIL_SCALE ? "detail" : scale < 0.8 ? "icons" : "labels");

/** Where a label sits around its node: top, bottom, left or right. */
export type Side = "t" | "b" | "l" | "r";

// Punctuation that reads badly right before "…" (closing brackets are kept so "(x)" stays whole).
const TRAILING = /[\s.,;:!?(\[{“‘"'·–—-]+$/u;

/** Canvas truncation (ruling R1): last word boundary within `max` chars, else a hard cut, then "…". */
export function truncate(label: string, max = 28): string {
  if (label.length <= max) return label;
  const head = label.slice(0, max);
  const space = head.lastIndexOf(" ");
  const cut = label[max] === " " ? head : space > 0 ? head.slice(0, space) : head;
  return (cut.replace(TRAILING, "") || head) + "…";
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean);
export const bareWord = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

// A label that already says the thing is absent or negative is shown as it is, never with "No " in front.
const NEGATED = /\b(no|not|negative|absent|normal|without|denies|denied)\b/i;
const lowerFirst = (text: string) => (/^\p{Lu}\p{Ll}/u.test(text) ? text[0].toLowerCase() + text.slice(1) : text);

/**
 * An absent finding's canvas label, from the whole label: "Foot ulcer" → "No foot ulcer"; a label already
 * negated stays as it is ("Celiac serology negative"). Ruling R3 is kept for labels starting with "No ":
 * "No diabetes (HbA1c 5.2%)" → "No diabetes".
 */
export function negativeLabel(label: string): string {
  const w = words(label);
  if (/^no$/i.test(w[0] ?? "") && w[1]) return `No ${bareWord(w[1])}`;
  if (NEGATED.test(label)) return truncate(label.trim());
  return truncate(`No ${lowerFirst(label.trim())}`);
}

type Tone = "label" | "year" | "signal" | "negative" | "detail";
export type Line = { text: string; tone: Tone; quote?: string };

// ---------------------------------------------------------------- text metrics (estimated: SVG has no layout pass at render)

type Font = "sans" | "serif" | "mono";
// Average advance per glyph class, in em, measured in Chromium: Atkinson Hyperlegible Next 700 and Source Serif 4 500
// (the opsz-14 instance next/font serves).
// Classes: space, narrow, wide, capital, digit, lowercase, other. Atkinson Hyperlegible Mono is 0.63em for every glyph.
const EM: Record<Exclude<Font, "mono">, number[]> = {
  sans: [0.31, 0.32, 0.85, 0.66, 0.59, 0.56, 0.7],
  serif: [0.23, 0.33, 0.94, 0.67, 0.54, 0.58, 0.54],
};
const glyphClass = (ch: string) =>
  /\s/.test(ch) ? 0 : /[ijlI.,:;'!|()[\]ftr-]/.test(ch) ? 1 : /[mwMW]/.test(ch) ? 2 : /[A-Z]/.test(ch) ? 3 : /\d/.test(ch) ? 4 : /[a-z]/.test(ch) ? 5 : 6;

/** Estimated rendered width of `text` at `size` px. */
export function textWidth(text: string, size: number, font: Font): number {
  if (font === "mono") return [...text].length * 0.63 * size;
  return [...text].reduce((w, ch) => w + EM[font][glyphClass(ch)], 0) * size;
}
// Text box above and below the baseline (Chromium's SVG text bbox for these fonts).
export const ASCENT = 0.98;
export const DESCENT = 0.32;

const TONE: Record<Tone, { size: number; font: Font }> = {
  label: { size: 13, font: "sans" },
  negative: { size: 13, font: "sans" },
  year: { size: 11, font: "mono" },
  signal: { size: 12, font: "sans" },
  detail: { size: 13, font: "mono" }, // 11px mono specialty + 13px serif quote; 13 bounds the line height
};
const lineWidth = (l: Line) =>
  l.tone === "detail" ? textWidth(l.text, 11, "mono") + textWidth(l.quote ?? "", 13, "serif") : textWidth(l.text, TONE[l.tone].size, TONE[l.tone].font);

// ---------------------------------------------------------------- label content

const firstWords = (text: string, n: number) => {
  const w = words(text);
  return w.slice(0, n).join(" ") + (w.length > n ? "…" : "");
};

/** `specialty · “first 8 words of the first record quote”` — shown past 1.6× zoom. */
function detailLine(f: Finding | undefined): Line | null {
  if (!f) return null;
  const excerpt = f.record_refs[0]?.excerpt;
  const quote = excerpt ? `“${firstWords(excerpt, 8)}”` : undefined;
  if (!f.specialty && !quote) return null;
  return { text: f.specialty && quote ? `${f.specialty} · ` : (f.specialty ?? ""), tone: "detail", quote };
}

/** Phone one-word label (ruling R15): the body system, or the label itself when it has none. */
const phoneName = (node: NodePos) => (node.system === "other" ? truncate(node.label, 16) : SYSTEM_LABEL[node.system]);

/** Canvas text for a node, derived from its data; empty when zoomed out past 0.8×. */
export function labelLines(node: NodePos, narrow: boolean, zoom: ZoomLevel, finding?: Finding): Line[] {
  if (zoom === "icons") return [];
  const year: Line[] = node.year ? [{ text: node.year, tone: "year" }] : [];
  switch (node.kind) {
    case "finding":
    case "uncertain": {
      const detail = zoom === "detail" ? detailLine(finding) : null;
      const name = narrow ? phoneName(node) : truncate(node.label);
      const text = node.kind === "uncertain" ? `${name}?` : name;
      return [{ text, tone: "label" }, ...year, ...(detail ? [detail] : [])];
    }
    // Linked to no hypothesis: name only, so the extra nodes stay quiet.
    case "context":
      return [{ text: narrow ? phoneName(node) : truncate(node.label), tone: "label" }];
    case "negative":
      return [{ text: negativeLabel(node.label), tone: "negative" }];
    // The test name and its year only: whether a result was normal or settled anything is for the panel to say.
    case "prior": {
      if (narrow) return [{ text: node.year ?? "Test", tone: "label" }, { text: "prior test", tone: "signal" }];
      const showYear = node.year && !node.label.includes(node.year);
      return [{ text: truncate(node.label), tone: "label" }, ...(showYear ? year : [])];
    }
    case "missing": {
      const text = narrow ? bareWord(words(node.label)[0] ?? "") : truncate(words(node.label).slice(0, 3).join(" "));
      return [{ text, tone: "label" }, { text: "missing?", tone: "signal" }];
    }
  }
}

// ---------------------------------------------------------------- label geometry

const LINE_HEIGHT = 15;
const LABEL_GAP = 4; // between the circle and the label's text box

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Where a label block sits relative to its node centre, and its estimated text box. */
export function labelGeometry(lines: Line[], side: Side, r: number) {
  const n = lines.length;
  const ascent = ASCENT * TONE[lines[0].tone].size;
  const descent = DESCENT * TONE[lines[n - 1].tone].size;
  const height = ascent + (n - 1) * LINE_HEIGHT + descent;
  const first =
    side === "t" ? -r - LABEL_GAP - height + ascent : side === "b" ? r + LABEL_GAP + ascent : -height / 2 + ascent;
  const x = side === "l" ? -(r + LABEL_GAP) : side === "r" ? r + LABEL_GAP : 0;
  const anchor: "end" | "start" | "middle" = side === "l" ? "end" : side === "r" ? "start" : "middle";
  const w = Math.max(...lines.map(lineWidth));
  const x0 = anchor === "end" ? x - w : anchor === "start" ? x : -w / 2;
  return { x, first, anchor, box: { x0, y0: first - ascent, x1: x0 + w, y1: first - ascent + height } as Box };
}

/**
 * A node's label block: one `<text data-label>`, a `<tspan>` per line, on `side` of a circle of radius `r`.
 * `scale` is the zoom: the block is drawn at 1/scale so text keeps its size while the graph spreads out.
 */
function NodeLabel({ lines, side, r, scale }: { lines: Line[]; side: Side; r: number; scale: number }) {
  if (!lines.length) return null;
  const { x, first, anchor } = labelGeometry(lines, side, r * scale);
  return (
    <g transform={scale === 1 ? undefined : `scale(${1 / scale})`}>
      <text data-label className="cn-label" textAnchor={anchor} aria-hidden="true">
        {lines.map((line, i) => (
          <tspan
            key={i}
            x={round(x)}
            y={round(first + i * LINE_HEIGHT)}
            className={`cn-l-${line.tone}`}
            data-testid={line.tone === "detail" ? "finding-detail" : undefined}
          >
            {line.text}
            {line.quote && (
              <tspan className="cn-quote" data-quote>
                {line.quote}
              </tspan>
            )}
          </tspan>
        ))}
      </text>
    </g>
  );
}

const round = (v: number) => Math.round(v * 10) / 10;

export type NodeEvents = {
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onFocus: (id: string | null) => void;
};

type ButtonProps = NodeEvents & {
  id: string;
  x: number;
  y: number;
  r: number;
  /** Full data label, never truncated: the accessible name. */
  name: string;
  narrow: boolean;
  selected: boolean;
  dim: boolean;
  /** Position in the load reveal (staggered 40ms apart). */
  order: number;
  testId?: string;
  children: ReactNode;
};

/** The shared interactive shell of hubs and nodes: a focusable `<g role="button">` centred on (x, y). */
export function NodeButton({ id, x, y, r, name, narrow, selected, dim, order, testId, onSelect, onHover, onFocus, children }: ButtonProps) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={name}
      data-node-id={id}
      data-testid={testId}
      data-selected={selected || undefined}
      data-dim={dim || undefined}
      className="cn-node"
      transform={`translate(${x} ${y})`}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onSelect(id);
      }}
      onPointerEnter={(e) => e.pointerType === "mouse" && onHover(id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onFocus(id)}
      onBlur={() => onFocus(null)}
    >
      <g className="cn-reveal" style={{ "--i": order } as CSSProperties}>
        {children}
        <circle className="cn-ring" r={r + 6} />
      </g>
      {/* Phone tap target (≥ 40 CSS px at a 358px-wide SVG); outside the reveal, so it is full size from the start. */}
      {narrow && <circle data-hit r={Math.max(r, 24)} fill="transparent" pointerEvents="all" />}
    </g>
  );
}

const sys = (system: string) => `var(--${system})`;
const clipId = (id: string, half: "l" | "r") => `cn-half-${id.replace(/[^\w-]/g, "_")}-${half}`;

function Shape({ node, missing }: { node: NodePos; missing?: MissingEvidence }) {
  const { r } = node;
  const icon = SYSTEM_ICON[node.system];
  switch (node.kind) {
    case "finding":
    case "context":
      return (
        <>
          <circle r={r} fill={sys(node.system)} />
          {icon && <Icon name={icon} size={r * 1.2} color="#fff" />}
        </>
      );
    case "uncertain":
      return (
        <>
          <circle r={r} fill="var(--bg)" stroke={sys(node.system)} strokeWidth={2.2} strokeDasharray="5 4" />
          {icon && <Icon name={icon} size={r * 1.2} color={sys(node.system)} />}
        </>
      );
    case "negative":
      return (
        <>
          <circle r={r} fill="var(--bg)" stroke={sys(node.system)} strokeWidth={1.6} />
          {icon && <Icon name={icon} size={r * 1.25} color={sys(node.system)} opacity={0.75} />}
        </>
      );
    case "prior":
      // Half filled: the generic glyph for a test already done (what it showed is in the panel, not the shape).
      return (
        <>
          <clipPath id={clipId(node.id, "l")}>
            <rect x={-r - 2} y={-r - 2} width={r + 2} height={2 * r + 4} />
          </clipPath>
          <clipPath id={clipId(node.id, "r")}>
            <rect x={0} y={-r - 2} width={r + 2} height={2 * r + 4} />
          </clipPath>
          <circle r={r} fill="var(--bg)" stroke={sys(node.system)} strokeWidth={2.2} />
          <path d={`M0 ${-r}A${r} ${r} 0 0 0 0 ${r}Z`} fill={sys(node.system)} />
          <g clipPath={`url(#${clipId(node.id, "l")})`}>
            <Icon name="vial" size={r * 1.15} color="#fff" />
          </g>
          <g clipPath={`url(#${clipId(node.id, "r")})`}>
            <Icon name="vial" size={r * 1.15} color={sys(node.system)} />
          </g>
        </>
      );
    case "missing":
      return (
        <>
          <circle r={r + (r > 20 ? 9 : 6)} fill="none" stroke="var(--sig)" strokeWidth={1} strokeDasharray="2 5" opacity={0.6} />
          <circle r={r} fill="var(--bg)" stroke="var(--sig)" strokeWidth={2.2} strokeDasharray="6 5" />
          {/* A report that may already exist is a document; anything else is an open question. */}
          <Icon name={missing?.check_existing_first ? "doc" : "ask"} size={r * 1.15} color="var(--sig)" />
        </>
      );
  }
}

type NodeProps = NodeEvents & {
  node: NodePos;
  /** The label block, as placed by the owner (`labelLines`, minus a detail line that fits nowhere). */
  lines: Line[];
  side: Side;
  narrow: boolean;
  scale: number;
  selected: boolean;
  dim: boolean;
  order: number;
  missing?: MissingEvidence;
};

/** A finding, negative, prior result or missing item, with its label. */
export function Node({ node, lines, side, narrow, scale, missing, ...button }: NodeProps) {
  return (
    <NodeButton id={node.id} x={node.x} y={node.y} r={node.r} name={node.label} narrow={narrow} {...button}>
      <Shape node={node} missing={missing} />
      <NodeLabel lines={lines} side={side} r={node.r} scale={scale} />
    </NodeButton>
  );
}
