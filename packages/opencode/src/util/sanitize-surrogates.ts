// Regex that matches a JSON-escaped high surrogate (\uD800–\uDBFF)
// NOT followed by a JSON-escaped low surrogate (\uDC00–\uDFFF),
// or a JSON-escaped low surrogate NOT preceded by a high surrogate.
//
// This is necessary because JSON.stringify() (per ECMA-262) encodes lone
// surrogate code units as \uD8xx ASCII escapes, which are valid JavaScript
// but violate RFC 8259. Strict JSON parsers (Anthropic serde_json, OpenAI)
// reject these with errors like "no low surrogate in string".
const LONE_HIGH_SURROGATE = /\\u[dD][89aAbB][0-9a-fA-F]{2}(?!\\u[dD][cCdDeEfF][0-9a-fA-F]{2})/g
const LONE_LOW_SURROGATE = /(?<!\\u[dD][89aAbB][0-9a-fA-F]{2})\\u[dD][cCdDeEfF][0-9a-fA-F]{2}/g

const REPLACEMENT = "\\uFFFD"

export function sanitizeJsonSurrogates(json: string): string {
  if (!json.includes("\\uD") && !json.includes("\\ud")) return json
  return json.replace(LONE_HIGH_SURROGATE, REPLACEMENT).replace(LONE_LOW_SURROGATE, REPLACEMENT)
}
