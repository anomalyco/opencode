// B5: mechanical repair for malformed tool-call JSON arguments emitted by
// small models — smart quotes, single-quoted keys/strings, python literals,
// trailing commas, and unbalanced brackets. Adapted from a
// battle-tested production router-side repair table. Returns the repaired JSON
// string only when the input did not parse but the repaired form does;
// undefined otherwise, so callers fall through to their existing handling.
export function repair(raw: string): string | undefined {
  if (!raw || parses(raw)) return undefined
  const repaired = rewrite(raw)
  if (repaired === raw || !parses(repaired)) return undefined
  return repaired
}

// E1: Claude-trained models emit snake_case argument keys (file_path,
// old_string) against camelCase tool schemas. Converts top-level keys to
// camelCase generically; returns undefined when the input is not a JSON
// object or no key changes, so callers skip the extra validation round.
// Nested objects are left alone — their keys may be user data.
export function camelKeys(raw: string): string | undefined {
  const parsed = (() => {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return undefined
    }
  })()
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined
  const entries = Object.entries(parsed).map(
    ([key, value]) => [key.replace(/_+([a-zA-Z0-9])/g, (_, ch: string) => ch.toUpperCase()), value] as const,
  )
  if (entries.every(([key], index) => key === Object.keys(parsed)[index])) return undefined
  return JSON.stringify(Object.fromEntries(entries))
}

function parses(text: string) {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

const SMART_QUOTES: Record<string, string> = {
  "“": '"',
  "”": '"',
  "„": '"',
  "‘": "'",
  "’": "'",
  "‚": "'",
}

const PYTHON_LITERALS: Record<string, string> = {
  True: "true",
  False: "false",
  None: "null",
}

// Single pass over the argument string tracking string context, so quote
// conversion, literal replacement, and comma/bracket fixes never touch the
// inside of a legitimate double-quoted value.
function rewrite(raw: string) {
  const text = raw.replace(/[“”„‘’‚]/g, (ch) => SMART_QUOTES[ch])
  const closers: string[] = []
  let out = ""
  let quote: '"' | "'" | undefined
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === "\\") {
        const next = text[i + 1] ?? ""
        // \' is not a JSON escape; the single-quoted string is being
        // rewritten to double quotes, so the apostrophe becomes literal.
        out += quote === "'" && next === "'" ? "'" : ch + next
        i++
        continue
      }
      if (ch === quote) {
        out += '"'
        quote = undefined
        continue
      }
      out += quote === "'" && ch === '"' ? '\\"' : ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      out += '"'
      continue
    }
    if (ch === "{" || ch === "[") {
      closers.push(ch === "{" ? "}" : "]")
      out += ch
      continue
    }
    if (ch === "}" || ch === "]") {
      out = out.replace(/,\s*$/, "")
      if (closers[closers.length - 1] === ch) closers.pop()
      out += ch
      continue
    }
    if (/[A-Za-z]/.test(ch)) {
      const word = /^[A-Za-z]+/.exec(text.slice(i))![0]
      out += PYTHON_LITERALS[word] ?? word
      i += word.length - 1
      continue
    }
    out += ch
  }
  if (quote) out += '"'
  out = out.replace(/,\s*$/, "")
  while (closers.length) out += closers.pop()
  return out
}

export * as LLMRepair from "./repair"
