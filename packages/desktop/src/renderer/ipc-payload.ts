// The server still uses JSON codecs. Omit undefined object fields as JSON would,
// while keeping attachment bytes intact for the structured-clone transport.
export function ipcPayload(value: unknown): unknown {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(ipcPayload)
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, ipcPayload(item)]),
  )
}
