import { test, expect } from "bun:test"
import { repairSSE, repairSSEEvent } from "@/provider/sse-repair"

function sseResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

test("repairSSEEvent passes valid events unchanged", () => {
  const valid = `data: {"id":"abc","choices":[{"delta":{"content":"hi"}}]}`
  expect(repairSSEEvent(valid)).toBe(valid)
})

test("repairSSEEvent passes [DONE] unchanged", () => {
  expect(repairSSEEvent("data: [DONE]")).toBe("data: [DONE]")
})

test("repairSSEEvent leaves non-data lines untouched", () => {
  const block = `event: ping\n: keep-alive\nid: 5`
  expect(repairSSEEvent(block)).toBe(block)
})

test("repairSSEEvent repairs the Z.AI hallucinated-SSE payload", () => {
  const broken = `data: {"id":"20260420032348d6275404213948ac","choices":[{"index":0,"delta":{"role":"assistant","content":"data: {"id":"20260420032457d424e96cb1da4f11","choices":[{"index":0,"delta":{"role":"assistant","content":"Two"}}]}}]}`
  const repaired = repairSSEEvent(broken)
  expect(repaired).not.toBe(broken)
  const payload = repaired.slice("data:".length).trim()
  const parsed = JSON.parse(payload) as {
    id: string
    choices: Array<{ delta: { content: string } }>
  }
  expect(parsed.id).toBe("20260420032348d6275404213948ac")
  expect(typeof parsed.choices[0].delta.content).toBe("string")
})

test("repairSSEEvent leaves empty and [DONE] payloads untouched", () => {
  expect(repairSSEEvent("data:")).toBe("data:")
  expect(repairSSEEvent("data: [DONE]")).toBe("data: [DONE]")
})

test("repairSSEEvent repairs the Qwen truncated-then-spliced payload", () => {
  // Real-world Qwen sample: the first chunk is cut off mid-field (`logpro`)
  // and the server splices the next SSE frame (`data: {...}`) in place,
  // leaving a single malformed JSON line that jsonrepair must recover.
  const broken = `data: {"id":"chatcmpl-8w4gtjb6tplr8g1xoxrjvi","object":"chat.completion.chunk","created":1777577130,"model":"qwen/qwen3.6-27b","system_fingerprint":"qwen/qwen3.6-27b","choices":[{"index":0,"delta":{"reasoning_content":"\\n"},"logprodata: {"id":"chatcmpl-b7yoftfoinwhk4joyloyjt","object":"chat.completion.chunk","created":1777577321,"model":"qwen/qwen3.6-27b","system_fingerprint":"qwen/qwen3.6-27b","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Let"},"logprobs":null,"finish_reason":null}]}`
  const repaired = repairSSEEvent(broken)
  expect(repaired).not.toBe(broken)
  const payload = repaired.slice("data:".length).trim()
  const parsed = JSON.parse(payload) as {
    id: string
    model: string
    choices: Array<{ index: number; delta: Record<string, unknown> }>
  }
  // The outer frame's id/model must survive — these are the anchors the
  // downstream parser relies on to associate the chunk with a request.
  expect(parsed.id).toBe("chatcmpl-8w4gtjb6tplr8g1xoxrjvi")
  expect(parsed.model).toBe("qwen/qwen3.6-27b")
  expect(parsed.choices[0].index).toBe(0)
})

test("repairSSE passes through non-SSE responses unchanged", async () => {
  const res = new Response('{"a":1}', { headers: { "content-type": "application/json" } })
  const out = repairSSE(res)
  expect(out).toBe(res)
})

test("repairSSE repairs events while streaming", async () => {
  const broken = `data: {"id":"20260420032348d6275404213948ac","choices":[{"index":0,"delta":{"role":"assistant","content":"data: {"id":"20260420032457d424e96cb1da4f11","choices":[{"index":0,"delta":{"role":"assistant","content":"Two"}}]}}]}`
  const valid = `data: {"z":2}`
  const body = `${valid}\n\n${broken}\n\ndata: [DONE]\n\n`
  const out = await readAll(repairSSE(sseResponse(body)))
  const events = out.split("\n\n").filter((e) => e.length > 0)
  expect(events.length).toBe(3)
  expect(events[0]).toBe(valid)
  expect(events[2]).toBe("data: [DONE]")
  const repairedPayload = events[1].slice("data:".length).trim()
  expect(() => JSON.parse(repairedPayload)).not.toThrow()
})

test("repairSSE handles chunked boundaries split inside one event", async () => {
  const event = `data: {"id":"a","choices":[{"delta":{"content":"ok"}}]}\n\n`
  const encoder = new TextEncoder()
  const bytes = encoder.encode(event)
  const split = Math.floor(bytes.length / 2)
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(bytes.slice(0, split))
      ctrl.enqueue(bytes.slice(split))
      ctrl.close()
    },
  })
  const res = new Response(stream, { headers: { "content-type": "text/event-stream" } })
  const out = await readAll(repairSSE(res))
  expect(out).toBe(event)
})
