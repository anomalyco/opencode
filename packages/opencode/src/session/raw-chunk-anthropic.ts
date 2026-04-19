export type ParsedRawChunk =
  | { kind: "message_start"; input: number; cacheRead: number; cacheWrite: number }
  | { kind: "message_delta"; output: number }

export function parseAnthropicRawChunk(rawValue: unknown): ParsedRawChunk | null {
  if (typeof rawValue !== "object" || rawValue === null) return null
  if (!("type" in rawValue) || typeof (rawValue as any).type !== "string") return null

  const type = (rawValue as any).type as string

  if (type === "message_start") {
    const usage = (rawValue as any).message?.usage
    if (typeof usage !== "object" || usage === null) return null
    const input = usage.input_tokens
    if (typeof input !== "number") return null
    const cacheRead = usage.cache_read_input_tokens
    const cacheWrite = usage.cache_creation_input_tokens
    return {
      kind: "message_start",
      input,
      cacheRead: typeof cacheRead === "number" ? cacheRead : 0,
      cacheWrite: typeof cacheWrite === "number" ? cacheWrite : 0,
    }
  }

  if (type === "message_delta") {
    const usage = (rawValue as any).usage
    if (typeof usage !== "object" || usage === null) return null
    const output = usage.output_tokens
    if (typeof output !== "number") return null
    return { kind: "message_delta", output }
  }

  return null
}
