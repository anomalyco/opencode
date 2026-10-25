// Redact only the debug output; the resolved configuration must remain usable by providers.
const secretName = /(?:api.?key|secret|password|token$|authorization$|cookie$|credential|private.?key)/i

export function redactConfig(value: unknown, headers = false): unknown {
  if (Array.isArray(value)) return value.map((item) => redactConfig(item, headers))
  if (value === null || typeof value !== "object") return value

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item === "string" && (headers || secretName.test(key))) return [key, "***"]
      if (typeof item === "string" && /^https?:\/\//i.test(item)) {
        if (!URL.canParse(item)) return [key, "***"]
        const url = new URL(item)
        if (url.username || url.password || [...url.searchParams.keys()].some((name) => secretName.test(name)))
          return [key, "***"]
      }
      return [key, redactConfig(item, headers || key.toLowerCase() === "headers")]
    }),
  )
}
