interface BrowserReadlineOptions {
  input: AsyncIterable<string | Buffer> | Iterable<string | Buffer>
  crlfDelay?: number
}

function normalizeChunk(chunk: string | Buffer): string {
  return typeof chunk === "string" ? chunk : chunk.toString("utf8")
}

export function createInterface(options: BrowserReadlineOptions) {
  let closed = false

  return {
    async *[Symbol.asyncIterator]() {
      let pending = ""

      for await (const chunk of options.input as AsyncIterable<string | Buffer>) {
        if (closed) {
          return
        }

        pending += normalizeChunk(chunk)
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ""

        for (const line of lines) {
          yield line
        }
      }

      if (!closed && pending.length > 0) {
        yield pending
      }
    },
    close() {
      closed = true
    },
  }
}

export default {
  createInterface,
}
