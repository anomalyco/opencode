import { describe, expect, test } from "bun:test"
import { parseSSE } from "../src/wb/sse"

async function* fromText(text: string) {
  const encoder = new TextEncoder()
  yield encoder.encode(text)
}

async function collect(text: string) {
  const messages = []
  for await (const message of parseSSE(fromText(text))) messages.push(message)
  return messages
}

describe("parseSSE", () => {
  test("parses id, event and data fields", async () => {
    const messages = await collect(
      'id: 1\nevent: chunk\ndata: {"type":"text","data":{"text":"привет"}}\n\n',
    )

    expect(messages).toEqual([
      {
        id: "1",
        event: "chunk",
        data: '{"type":"text","data":{"text":"привет"}}',
        retry: undefined,
      },
    ])
  })

  test("joins multiple data lines and skips comments", async () => {
    const messages = await collect(": keepalive\ndata: line one\ndata: line two\n\n")

    expect(messages).toHaveLength(1)
    expect(messages[0]?.data).toBe("line one\nline two")
  })

  test("handles frames split across chunks and CRLF", async () => {
    const encoder = new TextEncoder()
    async function* chunks() {
      yield encoder.encode("data: one\r\n\r")
      yield encoder.encode('\ndata: two\n\nretry: 3000\n')
    }

    const messages = []
    for await (const message of parseSSE(chunks())) messages.push(message)

    expect(messages.map((message) => message.data)).toEqual(["one", "two"])
  })

  test("ignores frames without data", async () => {
    expect(await collect("retry: 3000\n\n")).toEqual([])
  })
})
