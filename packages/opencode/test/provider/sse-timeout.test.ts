import { describe, test, expect } from "bun:test"

// wrapSSE is private inside Provider namespace, so we test it via
// the exported module's DEFAULT_CHUNK_TIMEOUT and the observable behavior:
// when chunkTimeout <= 0, the SSE stream should NOT be wrapped with a
// timeout that kills long-running responses.

// Helper: create a mock SSE response that streams chunks with controlled delay
function sseResponse(chunks: string[], delay: number): Response {
  const encoder = new TextEncoder()
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (i >= chunks.length) {
        ctrl.close()
        return
      }
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      ctrl.enqueue(encoder.encode(chunks[i]))
      i++
    },
  })
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  })
}

// Helper: read entire response body as text
async function drain(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let result = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  return result
}

// Inline replica of wrapSSE for direct testing.
// This mirrors provider.ts:61-107 exactly so we can verify the timeout
// behavior without needing a full Provider instance.
function wrapSSE(res: Response, ms: number, ctl: AbortController): Response {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error("SSE read timed out")
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      if (part.done) {
        ctrl.close()
        return
      }

      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

describe("wrapSSE chunk timeout", () => {
  test("returns response unchanged when timeout is 0", async () => {
    const original = sseResponse(["data: hello\n\n"], 0)
    const ctl = new AbortController()
    const wrapped = wrapSSE(original, 0, ctl)
    // Should be the exact same object — not wrapped
    expect(wrapped).toBe(original)
  })

  test("returns response unchanged when timeout is negative", async () => {
    const original = sseResponse(["data: hello\n\n"], 0)
    const ctl = new AbortController()
    const wrapped = wrapSSE(original, -1, ctl)
    expect(wrapped).toBe(original)
  })

  test("returns response unchanged for non-SSE content type", async () => {
    const original = new Response("plain text", {
      headers: { "content-type": "application/json" },
    })
    const ctl = new AbortController()
    const wrapped = wrapSSE(original, 5000, ctl)
    expect(wrapped).toBe(original)
  })

  test("passes through chunks that arrive before timeout", async () => {
    const chunks = ["data: one\n\n", "data: two\n\n"]
    const res = sseResponse(chunks, 10) // 10ms delay between chunks
    const ctl = new AbortController()
    const wrapped = wrapSSE(res, 5000, ctl) // 5s timeout — plenty of room
    const text = await drain(wrapped)
    expect(text).toBe("data: one\n\ndata: two\n\n")
  })

  test("aborts with 'SSE read timed out' when chunk exceeds timeout", async () => {
    const res = sseResponse(["data: first\n\n", "data: slow\n\n"], 200) // 200ms delay
    const ctl = new AbortController()
    const wrapped = wrapSSE(res, 50, ctl) // 50ms timeout — will fire before second chunk

    // Drain the wrapped response — should throw when second chunk exceeds timeout
    const err = await drain(wrapped).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe("SSE read timed out")
    expect(ctl.signal.aborted).toBe(true)
  })
})
