export namespace XaiSSE {
  export const CHUNK = 32

  const SPLIT_TYPES = new Set(["response.reasoning_text.delta", "response.output_text.delta"])

  export function splitText(text: string, size = CHUNK): string[] {
    if (text.length <= size) return [text]
    const out: string[] = []
    let i = 0
    while (i < text.length) {
      let end = Math.min(i + size, text.length)
      if (end < text.length) {
        const window = text.slice(end, Math.min(end + 16, text.length))
        const sp = window.search(/[\s\n]/)
        if (sp >= 0) end += sp + 1
      }
      out.push(text.slice(i, end))
      i = end
    }
    return out
  }

  function eventType(block: string): string | undefined {
    const eventLine = block.match(/^event:\s*(.+)$/m)
    if (eventLine) return eventLine[1].trim()
    const dataLine = block.match(/^data:\s*(.+)$/m)
    if (!dataLine) return
    try {
      const parsed = JSON.parse(dataLine[1])
      return typeof parsed?.type === "string" ? parsed.type : undefined
    } catch {
      return
    }
  }

  function dataPayload(block: string): { obj: Record<string, unknown> } | undefined {
    const dataLine = block.match(/^data:\s*(.+)$/m)
    if (!dataLine) return
    try {
      const obj = JSON.parse(dataLine[1])
      if (!obj || typeof obj !== "object") return
      return { obj: obj as Record<string, unknown> }
    } catch {
      return
    }
  }

  function replaceData(block: string, obj: unknown): string {
    return block.replace(/^data:\s*.+$/m, `data: ${JSON.stringify(obj)}`)
  }

  export function expandBlock(block: string): string[] {
    const type = eventType(block)
    const payload = dataPayload(block)
    if (type && SPLIT_TYPES.has(type) && payload && typeof payload.obj.delta === "string") {
      const pieces = splitText(payload.obj.delta)
      if (pieces.length <= 1) return [block]
      return pieces.map((delta) => replaceData(block, { ...payload.obj, delta }))
    }
    return [block]
  }

  export function wrap(res: Response): Response {
    if (!res.body) return res
    if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffer = ""
    const stream = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          buffer += decoder.decode(chunk, { stream: true })
          const parts = buffer.split("\n\n")
          buffer = parts.pop() ?? ""
          for (const part of parts) {
            for (const kept of expandBlock(part)) {
              controller.enqueue(encoder.encode(kept + "\n\n"))
            }
          }
        },
        flush(controller) {
          buffer += decoder.decode()
          if (!buffer.trim()) return
          for (const kept of expandBlock(buffer)) {
            controller.enqueue(encoder.encode(kept))
          }
        },
      }),
    )
    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
}
