const ALPHANUMERIC = /^[a-zA-Z0-9_-]+$/

export interface SchemaValid {
  readonly valid: true
}

export interface SchemaInvalid {
  readonly valid: false
  readonly reason: "SCHEMA_INVALID"
  readonly detail: string
}

export type SchemaResult = SchemaValid | SchemaInvalid

export function validateSchema(input: {
  key: string
  title: string
  context: string
  proposedDecision: string
  consequences: string
  origin: { proposerId: string }
}): SchemaResult {
  if (!input.key || !ALPHANUMERIC.test(input.key)) {
    return { valid: false, reason: "SCHEMA_INVALID", detail: "key must be non-empty alphanumeric" }
  }
  if (!input.title.trim()) {
    return { valid: false, reason: "SCHEMA_INVALID", detail: "title must be non-empty" }
  }
  if (!input.context.trim()) {
    return { valid: false, reason: "SCHEMA_INVALID", detail: "context must be non-empty" }
  }
  if (!input.proposedDecision.trim()) {
    return { valid: false, reason: "SCHEMA_INVALID", detail: "proposedDecision must be non-empty" }
  }
  if (!input.consequences.trim()) {
    return { valid: false, reason: "SCHEMA_INVALID", detail: "consequences must be non-empty" }
  }
  if (!input.origin.proposerId.trim()) {
    return { valid: false, reason: "SCHEMA_INVALID", detail: "origin.proposerId must be non-empty" }
  }
  return { valid: true }
}
