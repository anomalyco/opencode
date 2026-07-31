const sensitiveKey =
  /authorization|cookie|token|secret|password|api[_-]?key|private[_-]?key|connection[_-]?string|reasoning|thinking|hidden[_-]?thought/i

export function sanitize(value: unknown, secrets: readonly string[]): unknown {
  return sanitizeValue(value, secrets.filter(Boolean), new WeakSet())
}

function sanitizeValue(value: unknown, secrets: readonly string[], seen: WeakSet<object>): unknown {
  if (typeof value === "string") return secrets.reduce((text, secret) => text.split(secret).join("[REDACTED]"), value)
  if (value === null || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeValue(value.message, secrets, seen),
    }
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, secrets, seen))
  if (value === undefined) return null
  if (typeof value === "symbol") return value.description ? `[Symbol:${value.description}]` : "[Symbol]"
  if (typeof value === "function") return "[Function]"
  if (seen.has(value)) return "[Circular]"

  seen.add(value)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : sanitizeValue(item, secrets, seen),
    ]),
  )
}
