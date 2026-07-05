/**
 * Unflattens dot-bracket notation keys into nested objects/arrays.
 *
 * Gemini models sometimes return tool call arguments in flattened form, e.g.
 * `{ "questions[0].header": "Auth", "questions[0].multiSelect": false }` instead
 * of the nested `{ questions: [{ header: "Auth", multiSelect: false }] }` that
 * downstream schema validation expects.
 */
export function unflattenArgs(args: Record<string, unknown> | null | undefined): Record<string, unknown> | null | undefined {
  if (!args || typeof args !== "object") return args
  const keys = Object.keys(args)
  if (keys.length === 0) return args

  // Fast-path: if no key contains '[', the args are already nested.
  const needsUnflatten = keys.some((k) => k.includes("["))
  if (!needsUnflatten) return args

  const result: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const tokens = tokenize(key)
    if (tokens.length > 0) setNested(result, tokens, args[key])
  }
  return result
}

/** Parse a flat key like "a[0].b.c[1]" into tokens: ["a", 0, "b", "c", 1] */
function tokenize(key: string): Array<string | number> {
  const tokens: Array<string | number> = []
  let i = 0
  while (i < key.length) {
    if (key[i] === "[") {
      // bracket segment
      const end = key.indexOf("]", i)
      if (end === -1) break // malformed key, stop parsing
      const inner = key.slice(i + 1, end)
      tokens.push(/^\d+$/.test(inner) ? Number(inner) : inner)
      i = end + 1
      if (key[i] === ".") i++ // skip trailing dot
    } else {
      // dot-delimited segment
      let end = i
      while (end < key.length && key[end] !== "." && key[end] !== "[") end++
      tokens.push(key.slice(i, end))
      i = end
      if (key[i] === ".") i++ // skip dot
    }
  }
  return tokens
}

const BANNED_KEYS = new Set(["__proto__", "constructor", "prototype"])

function setNested(obj: Record<string, unknown>, tokens: Array<string | number>, value: unknown): void {
  let current: any = obj
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i]
    if (typeof token === "string" && BANNED_KEYS.has(token)) return
    const next = tokens[i + 1]
    if (current[token as any] == null) {
      current[token as any] = typeof next === "number" ? [] : Object.create(null)
    }
    current = current[token as any]
  }
  const last = tokens[tokens.length - 1]
  if (typeof last === "string" && BANNED_KEYS.has(last)) return
  current[last as any] = value
}
