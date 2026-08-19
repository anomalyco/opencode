/**
 * Deterministic tool-call validation (VantaCode spec 3.4).
 *
 * Before a tool call from the model is executed, validate it against the actual
 * available tool schema: the tool must exist, and its arguments must satisfy the
 * (JSON Schema) parameter definition. Malformed calls are rejected with a precise
 * error so the caller can retry with a corrective instruction instead of crashing
 * or executing a tool "just in case".
 *
 * Dependency-free: works on plain JSON Schema objects so it can be unit tested and
 * reused across the native-Ollama path and the AI-SDK path.
 */

export interface ToolSchemaDef {
  readonly name: string
  readonly description?: string
  /** JSON Schema (object type) describing the parameters. */
  readonly parameters: Record<string, unknown>
}

export interface IntendedCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

export interface ValidationOk {
  readonly ok: true
  readonly tool: ToolSchemaDef
  readonly arguments: Record<string, unknown>
}

export interface ValidationError {
  readonly ok: false
  readonly code: "unknown_tool" | "missing_required" | "wrong_type" | "not_object"
  readonly message: string
  /** Suggestion the caller can feed back to the model on retry. */
  readonly suggestion: string
}

export type ValidationResult = ValidationOk | ValidationError

function jsonType(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

/** Whether a value satisfies a single JSON Schema `type` (string or array form). */
function typeMatches(value: unknown, schemaType: unknown): boolean {
  if (schemaType === undefined) return true
  const types = Array.isArray(schemaType) ? schemaType : [schemaType]
  const actual = jsonType(value)
  return types.some((t) => {
    if (t === "integer") return actual === "number" && Number.isInteger(value as number)
    if (t === "number") return actual === "number"
    return t === actual
  })
}

/**
 * Validate one intended tool call against the registry of available tools.
 */
export function validateToolCall(call: IntendedCall, tools: ReadonlyArray<ToolSchemaDef>): ValidationResult {
  const tool = tools.find((t) => t.name === call.name)
  if (!tool) {
    const names = tools.map((t) => t.name).join(", ")
    return {
      ok: false,
      code: "unknown_tool",
      message: `Unknown tool "${call.name}". Available tools: ${names || "(none)"}.`,
      suggestion: `Call one of the available tools exactly by name: ${names}. Do not invent tool names.`,
    }
  }

  const args = call.arguments ?? {}
  if (jsonType(args) !== "object") {
    return {
      ok: false,
      code: "not_object",
      message: `Arguments for "${call.name}" must be a JSON object, got ${jsonType(args)}.`,
      suggestion: `Provide arguments for "${call.name}" as a JSON object matching its schema.`,
    }
  }

  const schema = tool.parameters ?? {}
  const properties = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {}
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []

  const missing = required.filter((key) => args[key] === undefined)
  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing_required",
      message: `Missing required argument(s) for "${call.name}": ${missing.join(", ")}.`,
      suggestion:
        `Call "${call.name}" again and include the required argument(s): ` +
        missing.map((m) => `"${m}"`).join(", ") +
        ".",
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key]
    if (!prop) continue // additional properties are tolerated; only defined ones are type-checked
    if (!typeMatches(value, prop.type)) {
      return {
        ok: false,
        code: "wrong_type",
        message: `Argument "${key}" for "${call.name}" has wrong type: expected ${JSON.stringify(prop.type)}, got ${jsonType(value)}.`,
        suggestion: `Fix the type of "${key}" (expected ${JSON.stringify(prop.type)}) and call "${call.name}" again.`,
      }
    }
  }

  return { ok: true, tool, arguments: args }
}

/**
 * Convert a validation failure into a corrective tool-result-style message the
 * model can read on the next turn. Keeps the loop deterministic: reject + retry
 * instead of executing a guessed call.
 */
export function validationRetryMessage(error: ValidationError): string {
  return `Tool call rejected: ${error.message} ${error.suggestion}`
}
