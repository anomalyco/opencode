function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function readToolStructured(value: unknown) {
  if (!record(value)) return
  if ("structured" in value) return value.structured
  return value.metadata
}

export function hasToolStructured(value: unknown): value is Record<string, unknown> & { structured: unknown } {
  return record(value) && "structured" in value
}

export function readToolRendererMetadata(toolName: string, value: unknown) {
  if (!record(value)) return
  if (record(value.metadata)) return value.metadata
  if (toolName !== "visualization_create" && record(value.structured)) return value.structured
}

export function attachToolStructured<T extends object>(state: T, structured: unknown): T & { structured?: unknown } {
  if (structured === undefined) return state
  return { ...state, structured }
}
