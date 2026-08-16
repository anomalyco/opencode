import { describe, expect, test } from "bun:test"
import { XaiSSE } from "../../src/util/xai-sse"

function sse(type: string, data: Record<string, unknown>) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}`
}

describe("XaiSSE.splitText", () => {
  test("keeps short text intact", () => {
    expect(XaiSSE.splitText("hello")).toEqual(["hello"])
  })

  test("splits long text near word boundaries", () => {
    const text = "The quick brown fox jumps over the lazy dog and then keeps going for a while."
    const parts = XaiSSE.splitText(text)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join("")).toBe(text)
    expect(parts.every((part) => part.length <= XaiSSE.CHUNK + 16)).toBe(true)
  })
})

describe("XaiSSE.expandBlock", () => {
  test("splits fat reasoning and output text deltas", () => {
    const text = "x".repeat(XaiSSE.CHUNK * 3)
    const reasoning = XaiSSE.expandBlock(sse("response.reasoning_text.delta", { delta: text }))
    const output = XaiSSE.expandBlock(sse("response.output_text.delta", { delta: text }))
    expect(reasoning.length).toBeGreaterThan(1)
    expect(output.length).toBeGreaterThan(1)
    expect(reasoning.map((block) => JSON.parse(block.match(/^data: (.+)$/m)![1]).delta).join("")).toBe(text)
    expect(output.map((block) => JSON.parse(block.match(/^data: (.+)$/m)![1]).delta).join("")).toBe(text)
  })

  test("leaves reasoning summary events untouched", () => {
    const block = sse("response.reasoning_summary_text.delta", { delta: "summary " + "y".repeat(80) })
    expect(XaiSSE.expandBlock(block)).toEqual([block])
  })

  test("leaves non-text events untouched", () => {
    const block = sse("response.created", { response: { id: "r1" } })
    expect(XaiSSE.expandBlock(block)).toEqual([block])
  })
})

describe("XaiSSE.wrap", () => {
  test("re-emits split SSE events from a fat reasoning delta", async () => {
    const text = "word ".repeat(20)
    const body = `${sse("response.reasoning_text.delta", { item_id: "rs_1", delta: text })}\n\n`
    const res = XaiSSE.wrap(
      new Response(body, {
        headers: { "content-type": "text/event-stream" },
      }),
    )
    const raw = await res.text()
    const deltas = [...raw.matchAll(/^data: (.+)$/gm)].map((match) => JSON.parse(match[1]).delta)
    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas.join("")).toBe(text)
  })
})
