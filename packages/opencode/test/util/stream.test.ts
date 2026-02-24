import { describe, expect, test } from "bun:test"
import { readNullTerminated } from "../../src/util/stream"

function stream(chunks: Uint8Array[]) {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[i]
      if (!chunk) {
        controller.close()
        return
      }
      i += 1
      controller.enqueue(chunk)
    },
  })
}

async function collect(input: AsyncIterable<string>) {
  const result: string[] = []
  for await (const item of input) {
    result.push(item)
  }
  return result
}

describe("util.stream", () => {
  test("readNullTerminated parses records across chunk boundaries", async () => {
    const e = new TextEncoder()
    const output = await collect(readNullTerminated(stream([e.encode("a\0b"), e.encode("c\0de"), e.encode("f\0")])))
    expect(output).toEqual(["a", "bc", "def"])
  })

  test("readNullTerminated skips empty records and keeps trailing partial", async () => {
    const e = new TextEncoder()
    const output = await collect(readNullTerminated(stream([e.encode("\0a\0\0b\0c")])))
    expect(output).toEqual(["a", "b", "c"])
  })

  test("readNullTerminated preserves multibyte utf-8 split across chunks", async () => {
    const e = new TextEncoder()
    const bytes = e.encode("x\0café\0")
    const output = await collect(readNullTerminated(stream([bytes.slice(0, 6), bytes.slice(6, 8)])))
    expect(output).toEqual(["x", "café"])
  })
})
