import type { SimpleHighlight } from "@opentui/core"
import { Schema } from "effect"

// Output larger than this is never sniffed or colored: parsing and highlighting it would cost
// more than the colors are worth, and it is drawn as plain text exactly as before.
export const OUTPUT_LANGUAGE_LIMIT = 100_000

// The language a tool's output is colored in, from `syntax.tool_output`: a map from a tool name or
// a glob over tool names (`*` any run of characters, `?` one) to a language id, `auto` or `none`.
// An exact name wins over any glob; among globs the one with the most literal characters wins.
// `auto` sniffs the output and colors only what it recognizes; unset or `none` leaves it plain.
export function outputLanguage(settings: Record<string, string> | undefined, tool: string, output: string) {
  if (!settings || output.length > OUTPUT_LANGUAGE_LIMIT) return
  const value = settings[tool] ?? bestGlob(settings, tool)
  if (!value || value === "none") return
  if (value === "auto") return detectOutputLanguage(output)
  return value
}

function bestGlob(settings: Record<string, string>, tool: string) {
  return Object.entries(settings)
    .filter(([pattern]) => /[*?]/.test(pattern) && globToRegExp(pattern).test(tool))
    .toSorted(([a], [b]) => b.replace(/[*?]/g, "").length - a.replace(/[*?]/g, "").length)
    .at(0)?.[1]
}

function globToRegExp(pattern: string) {
  const body = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${body}$`)
}

// What `syntax.tool_output` says for a tool: its exact name, else the most specific glob.
export function toolOutputSetting(settings: Record<string, string> | undefined, tool: string) {
  if (!settings) return
  return settings[tool] ?? bestGlob(settings, tool)
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const detected = new Map<string, string | undefined>()
const DETECTED_ENTRIES = 500

// JSON is the only format sniffed: an output that starts and ends with a bracket pair and parses
// as JSON. The answer is kept by content, so a remounted or reopened transcript parses nothing.
export function detectOutputLanguage(output: string) {
  const text = output.trim()
  if (text.length < 2 || text.length > OUTPUT_LANGUAGE_LIMIT) return
  const pair = text[0] + text[text.length - 1]
  if (pair !== "{}" && pair !== "[]") return
  if (detected.has(text)) return detected.get(text)
  const language = decodeJson(text)._tag === "Some" ? "json" : undefined
  detected.set(text, language)
  if (detected.size > DETECTED_ENTRIES) detected.delete(detected.keys().next().value!)
  return language
}

// The highlights of the whole output that fall inside the part of `shown` it shares with the
// output, so a collapsed preview takes the colors the whole output parses to.
export function previewHighlights(shown: string, output: string, highlights: SimpleHighlight[]) {
  const limit = Math.min(shown.length, output.length)
  let shared = 0
  while (shared < limit && shown[shared] === output[shared]) shared++
  if (shared === output.length) return highlights
  return highlights.flatMap((highlight): SimpleHighlight[] =>
    highlight[0] >= shared ? [] : [[highlight[0], Math.min(highlight[1], shared), highlight[2]]],
  )
}
