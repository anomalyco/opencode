// Some OpenAI-compatible providers (e.g. NVIDIA NIM) violate the spec by
// returning numeric tool call IDs. The AI SDK requires strings.

export function coerceNumericToolCallIds(obj: unknown): void {
  if (!obj || typeof obj !== "object") return
  if (Array.isArray(obj)) {
    for (const item of obj) coerceNumericToolCallIds(item)
    return
  }
  const record = obj as Record<string, unknown>
  if ("tool_calls" in record && Array.isArray(record.tool_calls)) {
    for (const tc of record.tool_calls) {
      if (tc && typeof tc === "object" && "id" in tc && typeof tc.id === "number") {
        tc.id = String(tc.id)
      }
    }
  }
  if ("delta" in record && record.delta && typeof record.delta === "object") {
    const delta = record.delta as Record<string, unknown>
    if ("tool_calls" in delta && Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        if (tc && typeof tc === "object" && "id" in tc && typeof tc.id === "number") {
          tc.id = String(tc.id)
        }
      }
    }
  }
  for (const value of Object.values(record)) {
    coerceNumericToolCallIds(value)
  }
}

export function transformSSEStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        if (buffer) controller.enqueue(encoder.encode(buffer))
        controller.close()
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const jsonStr = line.slice(6)
          if (jsonStr === "[DONE]") {
            controller.enqueue(encoder.encode(line + "\n"))
            continue
          }
          try {
            const json = JSON.parse(jsonStr)
            coerceNumericToolCallIds(json)
            controller.enqueue(encoder.encode("data: " + JSON.stringify(json) + "\n"))
            continue
          } catch {
            // If parsing fails, pass through unchanged
          }
        }
        controller.enqueue(encoder.encode(line + "\n"))
      }
    },
  })
}

