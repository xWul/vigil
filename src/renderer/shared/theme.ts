export type Theme = "dark" | "light";

export const SANS = '"Geist", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
export const MONO = '"Geist Mono", "SF Mono", ui-monospace, Menlo, monospace';

export const TOKENS = {
  dark: {
    bg: "#13110f",
    surface: "#1a1816",
    selected: "#221f1c",
    border: "#272320",
    text: "#e8e4dc",
    textDim: "#9a9389",
    textFaint: "#5f594f",
    accent: "oklch(0.74 0.06 200)",
    accentDim: "oklch(0.74 0.06 200 / 0.16)",
    red: "oklch(0.66 0.13 25)",
    amber: "oklch(0.78 0.11 75)",
    green: "oklch(0.70 0.08 155)",
    trafficR: "#ff5f57",
    trafficY: "#febc2e",
    trafficG: "#28c840",
    kbdBg: "rgba(255,255,255,0.04)",
    kbdBorder: "rgba(255,255,255,0.06)",
  },
  light: {
    bg: "#faf8f5",
    surface: "#f3efe9",
    selected: "#ece7df",
    border: "#e2dcd2",
    text: "#1d1a16",
    textDim: "#6b6358",
    textFaint: "#a39c91",
    accent: "oklch(0.55 0.08 220)",
    accentDim: "oklch(0.55 0.08 220 / 0.13)",
    red: "oklch(0.55 0.13 25)",
    amber: "oklch(0.65 0.12 70)",
    green: "oklch(0.55 0.09 150)",
    trafficR: "#ff5f57",
    trafficY: "#febc2e",
    trafficG: "#28c840",
    kbdBg: "rgba(0,0,0,0.04)",
    kbdBorder: "rgba(0,0,0,0.06)",
  },
} as const;

export interface Tokens {
  bg: string;
  surface: string;
  selected: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentDim: string;
  red: string;
  amber: string;
  green: string;
  trafficR: string;
  trafficY: string;
  trafficG: string;
  kbdBg: string;
  kbdBorder: string;
}
