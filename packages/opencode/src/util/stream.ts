export async function* readNull(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let rest = ""

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break

    const parts = `${rest}${decoder.decode(chunk.value, { stream: true })}`.split("\0")
    rest = parts.pop() ?? ""

    for (const part of parts) {
      if (!part) continue
      yield part
    }
  }

  const tail = `${rest}${decoder.decode()}`
  if (!tail) return
  yield tail
}
