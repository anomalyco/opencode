const KNOWN_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "uri",
  "uri-reference",
  "uri-template",
  "uuid",
  "json-pointer",
  "relative-json-pointer",
  "regex",
])

export function stripUnknownFormats(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripUnknownFormats)
  if (!schema || typeof schema !== "object") return schema

  const input = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (key === "format" && typeof value === "string" && !KNOWN_FORMATS.has(value)) {
      continue
    }

    if (
      key === "properties" ||
      key === "patternProperties" ||
      key === "$defs" ||
      key === "definitions" ||
      key === "dependentSchemas"
    ) {
      out[key] =
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripUnknownFormats(v)]),
            )
          : value
      continue
    }

    if (
      key === "items" ||
      key === "additionalProperties" ||
      key === "unevaluatedProperties" ||
      key === "contains" ||
      key === "propertyNames" ||
      key === "if" ||
      key === "then" ||
      key === "else" ||
      key === "not"
    ) {
      out[key] = stripUnknownFormats(value)
      continue
    }

    if (
      (key === "allOf" || key === "anyOf" || key === "oneOf" || key === "prefixItems") &&
      Array.isArray(value)
    ) {
      out[key] = value.map(stripUnknownFormats)
      continue
    }

    out[key] = stripUnknownFormats(value)
  }

  return out
}
