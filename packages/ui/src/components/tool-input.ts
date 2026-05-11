/**
 * Best-effort extraction of fully-formed key/value pairs from a partial
 * tool-input JSON string streamed during a pending tool call. Only closed
 * string literals, terminated numbers, and terminated booleans are
 * returned, so half-arrived values are ignored.
 */
export function parsePartialToolInput(raw: string): Record<string, any> | undefined {
  if (!raw) return
  const out: Record<string, any> = {}
  let any = false
  for (const match of raw.matchAll(/"([^"\\]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    const key = match[1]
    if (!key) continue
    try {
      out[key] = JSON.parse(`"${match[2]}"`)
    } catch {
      out[key] = match[2]
    }
    any = true
  }
  for (const match of raw.matchAll(/"([^"\\]+)"\s*:\s*(-?\d+(?:\.\d+)?)(?=[,}\s])/g)) {
    const key = match[1]
    if (!key) continue
    const value = Number(match[2])
    if (Number.isFinite(value)) {
      out[key] = value
      any = true
    }
  }
  for (const match of raw.matchAll(/"([^"\\]+)"\s*:\s*(true|false)(?=[,}\s])/g)) {
    const key = match[1]
    if (!key) continue
    out[key] = match[2] === "true"
    any = true
  }
  return any ? out : undefined
}

/**
 * Counts the number of lines (1-indexed) inside a streaming JSON string
 * value identified by `key`, even when the value is still open (closing
 * quote has not arrived yet). Returns 0 when the key is missing.
 *
 * Useful for live progress like "writing /tmp/foo.ts 348 lines" while a
 * large `content` / `newString` / `oldString` field is streaming in.
 */
export function countPartialStringLines(raw: string, key: string): number {
  if (!raw || !key) return 0
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const start = raw.match(new RegExp(`"${escaped}"\\s*:\\s*"`))
  if (!start || start.index === undefined) return 0
  let i = start.index + start[0].length
  let lines = 1
  while (i < raw.length) {
    const ch = raw[i]
    if (ch === "\\" && i + 1 < raw.length) {
      if (raw[i + 1] === "n") lines++
      i += 2
      continue
    }
    if (ch === '"') break
    i++
  }
  return lines
}
