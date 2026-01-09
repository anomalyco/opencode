export async function* streamLines(stdout: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line) yield line
      }
    }

    if (buffer) yield buffer
  } finally {
    reader.releaseLock()
  }
}
