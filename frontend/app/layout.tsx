import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  Atkinson_Hyperlegible_Mono,
  Atkinson_Hyperlegible_Next,
  Source_Serif_4,
} from "next/font/google";
import "./globals.css";

// next/font has no fallback metrics for the Atkinson families, so the
// metric-adjusted fallback is off and a plain system stack is used instead.
const uiFont = Atkinson_Hyperlegible_Next({
  variable: "--font-ui",
  subsets: ["latin"],
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

const monoFont = Atkinson_Hyperlegible_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  adjustFontFallback: false,
  fallback: ["ui-monospace", "monospace"],
});

const serifFont = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NextClue",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${uiFont.variable} ${monoFont.variable} ${serifFont.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
