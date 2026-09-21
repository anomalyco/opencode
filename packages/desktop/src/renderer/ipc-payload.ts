// The server still uses JSON codecs. Omit undefined fields from plain objects,
// while preserving other object types for the structured-clone transport.
export function ipcPayload(value: unknown): unknown {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(ipcPayload)
  if (value === null || typeof value !== "object") return value
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, ipcPayload(item)]),
  )
}
