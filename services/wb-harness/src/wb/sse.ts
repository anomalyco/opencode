export type SSEMessage = {
  id?: string
  event?: string
  data: string
  retry?: number
}

/**
 * Parses a Server-Sent Events byte stream into messages.
 * Frames are separated by a blank line; field lines are `name: value`.
 */
export async function* parseSSE(
  stream: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<SSEMessage> {
  const decoder = new TextDecoder()
  let buffer = ""

  for await (const chunk of stream) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true })
    buffer = buffer.replace(/\r\n/g, "\n")

    let index = buffer.indexOf("\n\n")
    while (index !== -1) {
      const frame = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const message = parseFrame(frame)
      if (message) yield message
      index = buffer.indexOf("\n\n")
    }
  }

  const tail = parseFrame(buffer)
  if (tail) yield tail
}

function parseFrame(frame: string): SSEMessage | undefined {
  if (!frame.trim()) return
  const data: string[] = []
  let id: string | undefined
  let event: string | undefined
  let retry: number | undefined

  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue
    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    const raw = colon === -1 ? "" : line.slice(colon + 1)
    const value = raw.startsWith(" ") ? raw.slice(1) : raw

    if (field === "data") data.push(value)
    if (field === "id") id = value
    if (field === "event") event = value
    if (field === "retry") retry = Number(value)
  }

  if (!data.length) return
  return { data: data.join("\n"), id, event, retry }
}
