export function filterResponseFrame(res: Response, ids: string[]): Response | undefined {
  if (!res.ok || !res.body || !ids.length) return
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""

  const filtered = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""
        for (const part of parts) {
          const dataLine = part.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim() ?? ""
          const skip = dataLine && (() => {
            try { return ids.includes(JSON.parse(dataLine)?.id) }
            catch { return false }
          })()
          if (!skip) controller.enqueue(encoder.encode(part + "\n\n"))
        }
      },
      flush(controller) {
        buffer += decoder.decode()
        if (buffer) controller.enqueue(encoder.encode(buffer))
      },
    }),
  )
  return new Response(filtered, res)
}
