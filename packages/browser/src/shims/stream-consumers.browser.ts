function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && value instanceof ReadableStream
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value
}

async function readChunks(input: unknown): Promise<Uint8Array[]> {
  if (isReadableStream(input)) {
    const reader = input.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    return chunks
  }

  if (isAsyncIterable<unknown>(input)) {
    const chunks: Uint8Array[] = []
    for await (const chunk of input) {
      chunks.push(toUint8Array(chunk))
    }
    return chunks
  }

  if (input && typeof (input as { on?: unknown }).on === "function") {
    return new Promise<Uint8Array[]>((resolve, reject) => {
      const chunks: Uint8Array[] = []
      const stream = input as {
        on(event: string, handler: (...args: any[]) => void): void
        off?(event: string, handler: (...args: any[]) => void): void
        removeListener?(event: string, handler: (...args: any[]) => void): void
      }

      const cleanup = () => {
        if (stream.off) {
          stream.off("data", onData)
          stream.off("end", onEnd)
          stream.off("error", onError)
          return
        }

        stream.removeListener?.("data", onData)
        stream.removeListener?.("end", onEnd)
        stream.removeListener?.("error", onError)
      }

      const onData = (chunk: unknown) => {
        chunks.push(toUint8Array(chunk))
      }

      const onEnd = () => {
        cleanup()
        resolve(chunks)
      }

      const onError = (error: unknown) => {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }

      stream.on("data", onData)
      stream.on("end", onEnd)
      stream.on("error", onError)
    })
  }

  throw new Error("Unsupported stream consumer input")
}

function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) {
    return chunk
  }

  if (typeof chunk === "string") {
    return new TextEncoder().encode(chunk)
  }

  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk)
  }

  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }

  return new TextEncoder().encode(String(chunk))
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export async function buffer(input: unknown): Promise<Uint8Array> {
  return concat(await readChunks(input))
}

export async function text(input: unknown): Promise<string> {
  return new TextDecoder().decode(await buffer(input))
}

export async function json<T = unknown>(input: unknown): Promise<T> {
  return JSON.parse(await text(input)) as T
}

export default {
  buffer,
  text,
  json,
}
