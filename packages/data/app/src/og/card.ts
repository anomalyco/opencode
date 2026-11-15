// The Open Graph card for model and lab pages, as a Satori element tree. Satori takes React-shaped elements; el()
// builds them as plain objects so Solid's JSX transform never sees them.
//
// The design is option A ("Headline"): the lab, the name set large, and one or two numbers on the banner's dot
// grid. Swapping the design means replacing modelCard() and labCard(); OgCard already carries the daily token series
// a chart design needs.

import { formatTokens } from "../lib/format"

export const width = 1200
export const height = 630

export type OgCard =
  | {
      kind: "model"
      path: string
      name: string
      // null for models without a known lab, such as stealth models.
      lab: { name: string; icon: string | null } | null
      // Last week's rank; null when the model wasn't ranked.
      rank: number | null
      // The page's two-month total; 0 before the model has any usage.
      tokens: number
      days: OgDay[]
      updatedAt: string | null
    }
  | {
      kind: "lab"
      path: string
      name: string
      icon: string | null
      tokens: number
      models: number
      days: OgDay[]
      updatedAt: string | null
    }

export type OgDay = { date: string; tokens: number }

export type SatoriElement = { type: string; props: Record<string, unknown> }

export function ogCardElement(card: OgCard, sprite: string) {
  return card.kind === "model" ? modelCard(card, sprite) : labCard(card, sprite)
}

function modelCard(card: Extract<OgCard, { kind: "model" }>, sprite: string) {
  const lab = card.lab
  return frame(
    row(
      lab
        ? el(
            "div",
            { display: "flex", alignItems: "center", gap: 20 },
            ...(lab.icon ? [labAvatar(sprite, lab.icon)] : []),
            el("div", { fontSize: 32, color: colors.faint }, lab.name),
          )
        : el("div", {}),
      brand(),
    ),
    title(card.name),
    stats([
      ...(card.tokens > 0 && card.rank ? [stat(`#${card.rank}`, "Rank, last week")] : []),
      ...(card.tokens > 0 ? [stat(formatTokens(card.tokens), "Tokens, last 2 months")] : []),
    ]),
  )
}

function labCard(card: Extract<OgCard, { kind: "lab" }>, sprite: string) {
  return frame(
    row(card.icon ? labAvatar(sprite, card.icon) : el("div", {}), brand()),
    title(card.name),
    stats([
      ...(card.tokens > 0 ? [stat(formatTokens(card.tokens), "Tokens, last 2 months")] : []),
      stat(String(card.models), card.models === 1 ? "Model" : "Models"),
    ]),
  )
}

// The Data site's dark palette (src/routes/index.css, [data-stats-theme="dark"]).
const colors = {
  background: "#161616",
  text: "#ffffff",
  faint: "#a3a3a3",
  accent: "#8190ff",
  dot: "#292929",
}
const pad = 80

function frame(...children: SatoriElement[]) {
  return el(
    "div",
    {
      display: "flex",
      position: "relative",
      width,
      height,
      backgroundColor: colors.background,
      fontFamily: "OpenTUI Mono",
      color: colors.text,
    },
    dots(),
    el(
      "div",
      { display: "flex", flexDirection: "column", position: "absolute", left: pad, top: 72, right: pad, bottom: 72 },
      ...children,
    ),
  )
}

// As tall as the lab avatar, so the header sits the same with or without one.
function row(...children: SatoriElement[]) {
  return el("div", { display: "flex", alignItems: "center", justifyContent: "space-between", height: 48 }, ...children)
}

function title(text: string) {
  // One line up to 104px; a name that would set smaller than 76px takes two lines at up to 88px.
  const one = fitSize(text, width - pad * 2, 104, 1, 0)
  const size = one >= 76 ? one : fitSize(text, width - pad * 2, 88, 2, 40)
  return el(
    "div",
    { display: "flex", flexGrow: 1, alignItems: "center" },
    el("div", { fontSize: size, lineHeight: 1.08, letterSpacing: -size * 0.02, maxWidth: width - pad * 2 }, text),
  )
}

function stats(items: SatoriElement[]) {
  return el("div", { display: "flex", gap: 120 }, ...items)
}

function stat(value: string, label: string) {
  return el(
    "div",
    { display: "flex", flexDirection: "column", gap: 18, flexShrink: 0, whiteSpace: "nowrap" },
    el("div", { fontSize: 76, lineHeight: 1, letterSpacing: -2 }, value),
    el("div", { fontSize: 28, lineHeight: 1, color: colors.faint }, label),
  )
}

// The OpenCode mark and DATA, the Data site's header lockup.
function brand() {
  const size = 24
  return el(
    "div",
    { display: "flex", alignItems: "center", gap: size * 0.62 },
    img(
      size * 1.2 * 0.8,
      size * 1.2,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300"><path d="M180 240H60V120H180V240Z" fill="#4b4b4b"/><path fill-rule="evenodd" d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="#ffffff"/></svg>`,
    ),
    el("div", { fontSize: size, fontWeight: 700, letterSpacing: size * 0.08, lineHeight: 1 }, "DATA"),
  )
}

// The lab avatar from the lab and model page heroes: the lab's icon in white on the accent square.
function labAvatar(sprite: string, icon: string) {
  const size = 48
  const inner = size * (42 / 64)
  return el(
    "div",
    {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      backgroundColor: colors.accent,
      flexShrink: 0,
    },
    img(inner, inner, iconSvg(sprite, icon, colors.text)),
  )
}

// The banner's dot grid: 8px squares on a 24px pitch, fading out down the card.
function dots() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="p" x="-4" y="1" width="24" height="24" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="${colors.dot}"/></pattern><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="m"><rect width="${width}" height="${height}" fill="url(#g)"/></mask></defs><rect width="${width}" height="${height}" fill="url(#p)" mask="url(#m)"/></svg>`
  return { type: "img", props: { width, height, src: svgUri(svg), style: { position: "absolute", left: 0, top: 0 } } }
}

// A standalone SVG for one icon of @opencode/ui's provider sprite, drawn in one colour.
export function iconSvg(sprite: string, id: string, color: string) {
  const match = sprite.match(new RegExp(`<symbol([^>]*)id="${id}"([^>]*)>([\\s\\S]*?)</symbol>`))
  if (!match) return ""
  const attrs = `${match[1]} ${match[2]}`
  const viewBox = attrs.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 24 24"
  const fill = attrs.match(/fill="([^"]+)"/)?.[1]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${fill ? ` fill="${fill}"` : ""}>${match[3].replaceAll("currentColor", color)}</svg>`
}

// The largest size up to `max` that sets `text` on `lines` lines within `width`.
function fitSize(text: string, width: number, max: number, lines: number, min: number) {
  const words = text.split(" ")
  const sizes = Array.from({ length: Math.ceil((max - min) / 2) }, (_, index) => max - index * 2)
  // OpenTUI Mono advances 0.6em per character.
  return sizes.find((size) => lineCount(words, Math.floor(width / (size * 0.6))) <= lines) ?? min
}

function lineCount(words: string[], perLine: number) {
  if (words.some((word) => word.length > perLine)) return Infinity
  return words.reduce(
    (state, word) =>
      state.current + 1 + word.length > perLine
        ? { lines: state.lines + 1, current: word.length }
        : { lines: state.lines, current: state.current + 1 + word.length },
    { lines: 1, current: -1 },
  ).lines
}

function el(type: string, style: Record<string, unknown>, ...children: (SatoriElement | string)[]): SatoriElement {
  return { type, props: { style, children: children.length === 1 ? children[0] : children } }
}

function img(w: number, h: number, svg: string): SatoriElement {
  return { type: "img", props: { width: w, height: h, src: svgUri(svg), style: { flexShrink: 0 } } }
}

function svgUri(svg: string) {
  return `data:image/svg+xml;base64,${btoa(Array.from(new TextEncoder().encode(svg), (byte) => String.fromCharCode(byte)).join(""))}`
}
