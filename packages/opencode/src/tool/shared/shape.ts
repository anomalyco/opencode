export function blank(value: unknown) {
  if (typeof value !== "string") return value
  return value.trim() ? value : undefined
}

export function zero(value: unknown) {
  if (typeof value === "string" && !value.trim()) return undefined
  if (value === 0) return undefined
  return value
}

export function seen(value: unknown) {
  if (value == null) return false
  if (value === false) return false
  if (value === 0) return false
  if (typeof value === "string") return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

export function empty(value: unknown) {
  if (Array.isArray(value) && value.length === 0) return undefined
  return value
}

type DiscriminatedInputConfig<T extends string> = {
  discriminant: string
  allowed: Record<T, readonly string[]>
  strip?: Partial<Record<string, (value: unknown) => boolean>>
}

function inert(value: unknown) {
  if (value == null) return true
  if (typeof value === "string") return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  if (value === false) return true
  if (value === 0) return true
  return false
}

export function sanitizeDiscriminatedInput<T extends string>(input: unknown, config: DiscriminatedInputConfig<T>) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const next = { ...(input as Record<string, unknown>) }
  const selected = next[config.discriminant]
  if (typeof selected !== "string") return next
  if (!(selected in config.allowed)) return next
  const allowed = new Set<string>([config.discriminant, ...config.allowed[selected as T]])
  for (const [key, value] of Object.entries(next)) {
    if (allowed.has(key)) continue
    if (inert(value) || config.strip?.[key]?.(value)) delete next[key]
  }
  return next
}
