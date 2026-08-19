import { describe, expect, test } from "bun:test"
import { filterNonChatSseChunks } from "@/provider/provider"

const CHUNK = `data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"hi"},"index":0}]}`
const BILLING = `data: {"object":"billing.summary","billing":{"cost_cny":0.01}}`
const DONE = `data: [DONE]`
const MALFORMED = `data: {not-json`
const COMMENT = `: keep-me`

async function readAll(res: Response) {
  return await res.text()
}

function sseResponse(body: BodyInit, init?: ResponseInit) {
  return new Response(body, {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    headers: {
      "content-type": "text/event-stream",
      ...(init?.headers ?? {}),
    },
  })
}

describe("filterNonChatSseChunks", () => {
  test("drops non-chat data lines (billing.summary) and keeps choices chunks and [DONE]", async () => {
    const input = [CHUNK, BILLING, DONE].join("\n") + "\n"
    const filtered = filterNonChatSseChunks(sseResponse(input))
    const text = await readAll(filtered)
    expect(text).toContain(CHUNK)
    expect(text).toContain(DONE)
    expect(text).not.toContain("billing.summary")
    expect(text).not.toContain("cost_cny")
  })

  test("line-buffers across split stream chunks", async () => {
    const full = [CHUNK, BILLING, DONE].join("\n") + "\n"
    // Split mid-line so billing.summary arrives across multiple chunks
    const mid = Math.floor(full.indexOf("billing.summary") + "billing".length)
    const parts = [full.slice(0, mid), full.slice(mid)]

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        const encoder = new TextEncoder()
        for (const part of parts) ctrl.enqueue(encoder.encode(part))
        ctrl.close()
      },
    })

    const filtered = filterNonChatSseChunks(sseResponse(stream))
    const text = await readAll(filtered)
    expect(text).toContain(CHUNK)
    expect(text).toContain(DONE)
    expect(text).not.toContain("billing.summary")
  })

  test("non-SSE response is unchanged", async () => {
    const body = JSON.stringify({ object: "billing.summary", billing: {} })
    const res = new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
    const filtered = filterNonChatSseChunks(res)
    expect(filtered).toBe(res)
    expect(await readAll(filtered)).toBe(body)
  })

  test("response without body is unchanged", () => {
    const res = new Response(null, {
      status: 204,
      headers: { "content-type": "text/event-stream" },
    })
    expect(filterNonChatSseChunks(res)).toBe(res)
  })

  test("malformed JSON data lines are kept", async () => {
    const input = [CHUNK, MALFORMED, DONE].join("\n") + "\n"
    const filtered = filterNonChatSseChunks(sseResponse(input))
    const text = await readAll(filtered)
    expect(text).toContain(MALFORMED)
    expect(text).toContain(CHUNK)
    expect(text).toContain(DONE)
  })

  test("preserves comments, empty lines, and metadata", async () => {
    const input = [COMMENT, "", CHUNK, BILLING, DONE].join("\n") + "\n"
    const filtered = filterNonChatSseChunks(
      sseResponse(input, {
        status: 201,
        statusText: "Created",
        headers: { "x-custom": "yes", "content-type": "text/event-stream; charset=utf-8" },
      }),
    )
    expect(filtered.status).toBe(201)
    expect(filtered.statusText).toBe("Created")
    expect(filtered.headers.get("x-custom")).toBe("yes")
    const text = await readAll(filtered)
    expect(text).toContain(COMMENT)
    expect(text).toContain(CHUNK)
    expect(text).not.toContain("billing.summary")
  })

  test("drops unknown object data lines without choices or error", async () => {
    const unknown = `data: {"object":"other.thing","value":1}`
    const input = [unknown, DONE].join("\n") + "\n"
    const text = await readAll(filterNonChatSseChunks(sseResponse(input)))
    expect(text).not.toContain("other.thing")
    expect(text).toContain(DONE)
  })

  test("keeps data line with choices even when object is billing.summary", async () => {
    const chunkWithBillingObject = `data: {"object":"billing.summary","choices":[{"delta":{"content":"hi"},"index":0}]}`
    const input = [chunkWithBillingObject, DONE].join("\n") + "\n"
    const text = await readAll(filterNonChatSseChunks(sseResponse(input)))
    expect(text).toContain("billing.summary")
    expect(text).toContain("choices")
    expect(text).toContain(DONE)
  })

  test("drops usage-only frame without choices or error", async () => {
    const usage = `data: {"usage":{"prompt_tokens":10,"completion_tokens":20},"object":"chat.completion"}`
    const input = [usage, DONE].join("\n") + "\n"
    const text = await readAll(filterNonChatSseChunks(sseResponse(input)))
    expect(text).not.toContain("usage")
    expect(text).not.toContain("prompt_tokens")
    expect(text).toContain(DONE)
  })

  test("keeps data line with error property", async () => {
    const errorLine = `data: {"error":{"message":"rate limit exceeded","type":"rate_limit"}}`
    const input = [errorLine, DONE].join("\n") + "\n"
    const text = await readAll(filterNonChatSseChunks(sseResponse(input)))
    expect(text).toContain("rate limit exceeded")
    expect(text).toContain(DONE)
  })
})
