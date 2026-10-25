/**
 * `bolt run --output-schema <file>`: force the final answer to be JSON that
 * validates against a JSON Schema, re-prompting with the validation errors
 * until it does (bounded attempts). The validator covers the structural
 * subset of JSON Schema that matters for machine-readable CLI output: type,
 * enum, const, required, properties, additionalProperties, items, bounds,
 * and lengths. Unknown keywords are ignored rather than rejected.
 */

/** Total prompt attempts (the initial answer plus retries). */
export const ATTEMPTS = 3

/** Instructions appended to the initial prompt when --output-schema is set. */
export function instructions(schema: unknown) {
  return [
    "Your final message must be a single JSON value that validates against this JSON Schema.",
    "Reply with the JSON only: no prose, no markdown fence, no explanation.",
    "",
    JSON.stringify(schema, null, 2),
  ].join("\n")
}

/** Retry prompt sent when the previous answer failed validation. */
export function feedback(errors: string[]) {
  return [
    "The previous answer did not validate against the required JSON Schema.",
    "Errors:",
    ...errors.map((error) => `- ${error}`),
    "",
    "Reply again with a single JSON value that fixes every error. JSON only: no prose, no markdown fence.",
  ].join("\n")
}

/**
 * Extract the JSON value from a response. Accepts the raw text or, when the
 * model ignored instructions and fenced the answer, the last fenced block.
 */
export function payload(text: string): { value: unknown } | undefined {
  const direct = parse(text.trim())
  if (direct) return direct
  const fences = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)]
  const last = fences.at(-1)
  if (!last) return undefined
  return parse(last[1].trim())
}

function parse(text: string): { value: unknown } | undefined {
  if (!text) return undefined
  try {
    return { value: JSON.parse(text) }
  } catch {
    return undefined
  }
}

/** Validate a value against the supported JSON Schema subset. Returns human-readable errors, empty when valid. */
export function validate(schema: unknown, value: unknown): string[] {
  return check(schema, value, "$")
}

function kind(value: unknown) {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number"
  return typeof value
}

function matches(expected: string, value: unknown) {
  if (expected === "number") return typeof value === "number"
  return kind(value) === expected
}

function check(schema: unknown, value: unknown, at: string): string[] {
  if (typeof schema === "boolean") return schema ? [] : [`${at}: schema forbids any value`]
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return []
  const rules = schema as Record<string, unknown>
  const errors: string[] = []

  const type = rules["type"]
  if (typeof type === "string" && !matches(type, value)) {
    errors.push(`${at}: expected ${type}, got ${kind(value)}`)
  }
  if (Array.isArray(type) && !type.some((entry) => typeof entry === "string" && matches(entry, value))) {
    errors.push(`${at}: expected one of ${type.join(", ")}, got ${kind(value)}`)
  }

  const options = rules["enum"]
  if (Array.isArray(options) && !options.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    errors.push(`${at}: value is not one of the allowed enum values`)
  }
  if ("const" in rules && JSON.stringify(rules["const"]) !== JSON.stringify(value)) {
    errors.push(`${at}: value does not equal the required const`)
  }

  if (typeof value === "string") {
    const min = rules["minLength"]
    const max = rules["maxLength"]
    if (typeof min === "number" && value.length < min) errors.push(`${at}: string shorter than minLength ${min}`)
    if (typeof max === "number" && value.length > max) errors.push(`${at}: string longer than maxLength ${max}`)
  }

  if (typeof value === "number") {
    const min = rules["minimum"]
    const max = rules["maximum"]
    if (typeof min === "number" && value < min) errors.push(`${at}: ${value} is below minimum ${min}`)
    if (typeof max === "number" && value > max) errors.push(`${at}: ${value} is above maximum ${max}`)
  }

  if (Array.isArray(value)) {
    const min = rules["minItems"]
    const max = rules["maxItems"]
    if (typeof min === "number" && value.length < min) errors.push(`${at}: fewer items than minItems ${min}`)
    if (typeof max === "number" && value.length > max) errors.push(`${at}: more items than maxItems ${max}`)
    const items = rules["items"]
    if (items !== undefined) {
      for (const [index, entry] of value.entries()) errors.push(...check(items, entry, `${at}[${index}]`))
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const required = rules["required"]
    if (Array.isArray(required)) {
      for (const name of required) {
        if (typeof name === "string" && !(name in record)) errors.push(`${at}: missing required property "${name}"`)
      }
    }
    const properties = rules["properties"]
    const known =
      properties !== null && typeof properties === "object" ? (properties as Record<string, unknown>) : undefined
    if (known) {
      for (const [name, sub] of Object.entries(known)) {
        if (name in record) errors.push(...check(sub, record[name], `${at}.${name}`))
      }
    }
    if (rules["additionalProperties"] === false && known) {
      for (const name of Object.keys(record)) {
        if (!(name in known)) errors.push(`${at}: unexpected property "${name}"`)
      }
    }
  }

  return errors
}

export * as OutputSchema from "./schema"
