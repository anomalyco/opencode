#!/usr/bin/env bun
// Keeps the web surfaces' greys on one shared scale. Fails when a stylesheet uses a grey, black or
// white that isn't on the scale, or types a scale grey straight into a rule instead of using a
// token. Files with a fixed look of their own (the arcade, the video tools, print) are listed in
// EXCEPTIONS with the reason. Usage:
//   bun script/check-greys.ts           report problems, exit 1 if any
//   bun script/check-greys.ts --json    every neutral literal with its outcome, for the colour audit
import path from "node:path"

const ROOTS = ["services/site/src", "packages/nav-menus/src", "packages/data/app/src"]

// The shared neutral scale. A step is a role, and the same step does the same job in light and dark.
const SCALE = {
  light: [
    "#fbfbfb",
    "#ffffff",
    "#f5f5f5",
    "#eeeeee",
    "#e0e0e0",
    "#d2d2d2",
    "#888888",
    "#6b6b6b",
    "#5c5c5c",
    "#3a3a3a",
    "#161616",
  ],
  dark: [
    "#0c0c0c",
    "#161616",
    "#1a1a1a",
    "#242424",
    "#2e2e2e",
    "#4b4b4b",
    "#6a6a6a",
    "#8f8f8f",
    "#aeaeae",
    "#dbdbdb",
    "#fafafa",
  ],
}

// Pure black and white always pass in masks (where #000 only means "opaque") and shadows.
const ALPHA_CONTEXT = /^(mask|-webkit-mask|box-shadow|text-shadow|filter|backdrop-filter|--[\w-]*shadow)/

const EXCEPTIONS: [RegExp, string][] = [
  [/component\/site\/arcade\//, "Arcade game: its own cabinet, screen and metal colours"],
  [/component\/site\/arcade3d\//, "Arcade game: its own cabinet, screen and metal colours"],
  [/component\/video-editor\//, "Internal video editor"],
  [/component\/font-film\//, "Font film: rendered video frames"],
  [/component\/font-share\//, "Font share cards: exported images"],
  [/component\/site\/device-preview\.css$/, "Device preview tool: device frames"],
  [/component\/site\/design-mode\.css$/, "Design mode: internal overlay"],
  [/component\/site\/legal-print\.css$/, "Print: black on white whatever the theme"],
  [
    /style\/token\/color\.css$/,
    "Legacy tokens: to remove when the dropdown, language picker, 404 and limits graph move to site tokens",
  ],
]

// Pure black is a token only for video letterboxing (--media-black).
const scale = new Set([...SCALE.light, ...SCALE.dark, "#000000"])

const files = (
  await Promise.all(ROOTS.map((root) => Array.fromAsync(new Bun.Glob(`${root}/**/*.css`).scan({ cwd: repo() }))))
).flat()

const entries = (
  await Promise.all(
    files.map(async (file) => {
      const source = await Bun.file(path.join(repo(), file)).text()
      const exception = EXCEPTIONS.find(([re]) => re.test(file))?.[1]
      const allowed = allowedRanges(source)
      return declarations(source).flatMap((decl) =>
        neutrals(decl.value).map((hex) => ({
          file,
          line: decl.line,
          property: decl.property,
          hex: hex.value,
          alpha: hex.alpha,
          text: `${decl.property}: ${decl.value}`.replace(/\s+/g, " ").slice(0, 160),
          outcome: outcome(
            decl,
            hex,
            exception ?? allowed.find((range) => decl.line >= range.from && decl.line <= range.to)?.why,
          ),
        })),
      )
    }),
  )
).flat()

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ scale: SCALE, exceptions: EXCEPTIONS.map(([re, why]) => [re.source, why]), entries }))
  process.exit(0)
}

const problems = entries.filter((entry) => entry.outcome.startsWith("problem"))
for (const p of problems) console.error(`${p.file}:${p.line}  ${p.hex}  ${p.outcome.slice(9)}  (${p.text})`)
if (problems.length) {
  console.error(
    `\n${problems.length} grey${problems.length === 1 ? "" : "s"} off the shared scale (script/check-greys.ts).`,
  )
  process.exit(1)
}

function outcome(
  decl: { property: string; value: string },
  hex: { value: string; alpha: boolean },
  exception: string | undefined,
) {
  const pure = hex.value === "#000000" || hex.value === "#ffffff"
  if (exception) return `exception: ${exception}`
  if (/^--([a-z]+-)?logo-/.test(decl.property)) return "exception: Brand logo greys (brand guidelines)"
  if (ALPHA_CONTEXT.test(decl.property) && pure) return "allowed: mask or shadow"
  if (hex.alpha && pure) return "allowed: black or white wash"
  if (pure && /color-mix\(.*#(000|fff)\b/i.test(decl.value)) return "allowed: shades a colour"
  if (!scale.has(hex.value)) return "problem: not on the scale"
  if (decl.property.startsWith("--") || decl.property === "initial-value") return "token"
  return "problem: use a token"
}

// Lines between `/* grey-ok: <reason> */` and `/* grey-ok-end */` keep their literal greys, for the
// few places tokens can't reach, such as the page behind the site.
function allowedRanges(source: string) {
  const lines = source.split("\n")
  return lines.flatMap((line, i) => {
    const why = line.match(/grey-ok:\s*(.*?)\s*\*\//)?.[1]
    if (!why) return []
    const end = lines.findIndex((next, j) => j > i && next.includes("grey-ok-end"))
    return [{ from: i + 1, to: end === -1 ? i + 1 : end + 1, why }]
  })
}

// Every declaration with its property and the line it starts on. Comments are blanked first, keeping
// line numbers.
function declarations(source: string) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
  return [...text.matchAll(/([\w-]+)\s*:([^;{}]+)/g)]
    .filter((m) => /#[0-9a-fA-F]|hsl|rgb/.test(m[2]))
    .map((m) => ({ property: m[1], value: m[2].trim(), line: text.slice(0, m.index).split("\n").length }))
}

// Neutral colour literals in a value: hex, hsl() with 0% saturation, and rgb() with equal channels.
function neutrals(value: string) {
  return [
    ...[...value.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g)].map((m) => {
      const h = m[1].length <= 4 ? [...m[1]].map((c) => c + c).join("") : m[1]
      return { value: `#${h.slice(0, 6).toLowerCase()}`, alpha: h.length === 8 }
    }),
    ...[...value.matchAll(/hsla?\(\s*[\d.]+(?:deg)?[\s,]+0%[\s,]+([\d.]+)%\s*(?:[,/]\s*([\d.]+%?))?\s*\)/g)].map(
      (m) => {
        const v = Math.round((Number(m[1]) / 100) * 255)
          .toString(16)
          .padStart(2, "0")
        return { value: `#${v}${v}${v}`, alpha: m[2] !== undefined }
      },
    ),
    ...[...value.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)/g)].map((m) => ({
      value: `#${[m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, "0")).join("")}`,
      alpha: m[4] !== undefined,
    })),
  ].filter((hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.value.slice(i, i + 2), 16))
    return Math.max(r, g, b) - Math.min(r, g, b) <= 6
  })
}

function repo() {
  return path.resolve(import.meta.dir, "..")
}
