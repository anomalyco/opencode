export function listValue<T>(value: T[] | Record<string, T> | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === "object") return Object.values(value)
  return []
}
