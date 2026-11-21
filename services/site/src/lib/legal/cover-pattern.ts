import type { architectPatterns } from "~/component/site/settings"
import { coverFieldMarkup, emitterPresets, fieldBottomMax, normalize, presets, type PatternParams } from "./pattern"

/*
 * The architect cover's field patterns (Settings › Architect pattern, or ?pattern= on a legal page):
 * the c3 square grid, or a pattern from the cover-patterns playground, drawn by pattern.ts. The
 * playground serves that same file, so a state there prints the same here.
 */

export type ArchitectPattern = (typeof architectPatterns)[number]

/** A custom lines pattern David tuned in the playground. */
const lines: Partial<PatternParams> = {
  primitive: "lines",
  spacing: 5,
  length: 4,
  weight: 0.3,
  rotation: -4.05,
  axis: "angle",
  offset: -180,
  falloff: 1,
  margin: 15,
  clearLogo: 4,
}

const slug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")

/** Every pattern by id, with its name: David's lines, then the playground's presets and emitters. */
export const coverPatterns = new Map<string, { name: string; params: Partial<PatternParams> }>([
  ["lines", { name: "Lines (David's)", params: lines }],
  ...[...presets, ...emitterPresets].map(
    (preset) => [slug(preset.name), preset] as [string, { name: string; params: Partial<PatternParams> }],
  ),
])

export const patternName = (id: ArchitectPattern) =>
  id === "grid" ? "Grid (current c3)" : (coverPatterns.get(id)?.name ?? id)

/**
 * A pattern from an id or from a playground state (its params as JSON): "grid" for the c3 grid,
 * the params of a pattern, or undefined when the value is neither.
 */
export function resolvePattern(value: string | undefined): Partial<PatternParams> | "grid" | undefined {
  if (!value) return undefined
  if (value === "grid") return "grid"
  const named = coverPatterns.get(value)
  if (named) return named.params
  const parsed = parseJson(value)
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Partial<PatternParams>) : undefined
}

/** How much higher US Letter's cover label sits than A4's, in mm: the covers are 1118 and 1052px tall. */
const letterShift = ((1118 - 1052) * 25.4) / 96

/** The pattern on the cover as SVG markup in sheet millimetres, for A4 or for the shorter US Letter. */
export function coverPatternMarkup(params: Partial<PatternParams>, sheet: "a4" | "letter") {
  if (sheet === "a4") return coverFieldMarkup(params)
  // On Letter the label moves up with the bottom edge, so the field ends as much higher, keeping
  // its 16mm of clear space above the label. Elements are placed again, so none is cut in half.
  const field = normalize(params).field
  return coverFieldMarkup({
    ...params,
    field: { ...field, h: Math.max(10, Math.min(field.h, fieldBottomMax - letterShift - field.y)) },
  })
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}
