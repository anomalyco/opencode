import { describe, expect, test } from "bun:test"
import { ProviderError } from "../../src/provider/error"
import { CODEX_CHUNK_TIMEOUT, CODEX_HEADER_TIMEOUT, fetchCodexHTTP } from "../../src/plugin/openai/codex-http"

const CREATED = "data: {\"type\":\"response.created\"}\n\n"

function sse(value: string, init?: ResponseInit) {
  return new Response(value, { headers: { "content-type": "text/event-stream" }, ...init })
}

function byteStream(chunks: Uint8Array[], onCancel?: () => void) {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++]
      if (chunk) controller.enqueue(chunk)
      else controller.close()
    },
    cancel() {
      onCancel?.()
    },
  })
}

function responseBytes(bytes: Uint8Array, headers = { "content-type": "text/event-stream" }) {
  return new Response(byteStream([bytes]), { headers })
}

describe("Codex HTTP transport", () => {
  test("uses the independent status retry policies", async () => {
    for (const [status, retries, delay] of [
      [502, 3, 3_000],
      [503, 3, 2_000],
      [504, 2, 3_000],
    ] as const) {
      let calls = 0
      const waits: number[] = []
      const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
        fetch: async () => ++calls <= retries ? new Response("retry", { status }) : sse(CREATED),
        sleep: async (ms) => void waits.push(ms),
        headerTimeout: 1,
      })
      expect(calls).toBe(retries + 1)
      expect(waits).toEqual(Array(retries).fill(delay))
      expect(await response.text()).toBe(CREATED)
    }
  })

  test("retries network failures without consuming HTTP counters", async () => {
    let calls = 0
    const waits: number[] = []
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => {
        calls++
        if (calls <= 3) throw new Error("connect failed")
        return sse(CREATED)
      },
      sleep: async (ms) => void waits.push(ms),
    })
    expect(calls).toBe(4)
    expect(waits).toEqual([3_000, 3_000, 3_000])
    expect(await response.text()).toBe(CREATED)
  })

  test("retries an overloaded first SSE event and replays accepted bytes exactly once", async () => {
    const overload = 'data: {"type":"error","code":"server_is_overloaded"}\r\n\r\n'
    const accepted = 'data: {"type":"response.created","text":"é"}\r\n\r\n'
    const chunks = [new Uint8Array(Buffer.from(accepted.slice(0, 18))), new Uint8Array(Buffer.from(accepted.slice(18)))]
    let calls = 0
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => {
        calls++
        if (calls === 1) return sse(overload)
        return new Response(new ReadableStream({
          pull(controller) {
            const chunk = chunks.shift()
            if (chunk) controller.enqueue(chunk)
            else controller.close()
          },
        }), { headers: { "content-type": "text/event-stream" } })
      },
      sleep: async () => {},
    })
    expect(calls).toBe(2)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(Buffer.from(accepted)))
  })

  test("exposes typed errors for malformed status-200 non-SSE bodies", async () => {
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => new Response("not sse", { status: 200, headers: { "content-type": "text/plain" } }),
    })
    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toBeInstanceOf(ProviderError.ResponseStreamError)
  })

  test("exports Codex timeout defaults", () => {
    expect(CODEX_HEADER_TIMEOUT).toBe(60_000)
    expect(CODEX_CHUNK_TIMEOUT).toBe(360_000)
  })

  test("keeps an exhausted SSE error readable exactly once", async () => {
    const error = 'data: {"type":"error","code":"server_is_overloaded"}\n\n'
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => sse(error),
      sleep: async () => {},
    })
    expect(await response.text()).toBe(error)
  })

  test("allows large later bytes when the first event is small", async () => {
    const first = 'data: {"type":"response.created"}\n\n'
    const later = "x".repeat(70_000)
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => sse(first + later),
    })
    expect(await response.text()).toBe(first + later)
  })

  test("does not read beyond the first event until the consumer pulls", async () => {
    const first = new TextEncoder().encode('data: {"type":"response.created"}\n\n')
    let reads = 0
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(first)
        },
        pull(controller) {
          reads++
          controller.enqueue(new TextEncoder().encode("later"))
        },
      }, { highWaterMark: 0 }), { headers: { "content-type": "text/event-stream" } }),
    })
    expect(reads).toBe(0)
    const reader = response.body?.getReader()
    expect(await reader?.read()).toEqual({ done: false, value: first })
    expect(reads).toBe(1)
    await reader?.cancel()
  })

  test("accepts nested error codes and ignores overload text in output", async () => {
    const nested = 'data: {"type":"error","error":{"code":"service_unavailable_error"}}\n\n'
    let calls = 0
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => {
        calls++
        return calls === 1 ? sse(nested) : sse('data: {"type":"response.output_text.delta","delta":"server_is_overloaded"}\n\n')
      },
      sleep: async () => {},
    })
    expect(calls).toBe(2)
    expect(await response.text()).toContain("server_is_overloaded")
  })

  test("turns an empty SSE response into a typed failing status-200 stream", async () => {
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => sse(""),
    })
    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toBeInstanceOf(ProviderError.ResponseStreamError)
  })

  test("handles LF separator split across byte chunks", async () => {
    const bytes = new TextEncoder().encode(CREATED)
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => new Response(byteStream([bytes.slice(0, -1), bytes.slice(-1)]), { headers: { "content-type": "text/event-stream" } }),
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  test("handles CRLF separator split across byte chunks", async () => {
    const value = 'data: {"type":"response.created"}\r\n\r\n'
    const bytes = new TextEncoder().encode(value)
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => new Response(byteStream([bytes.slice(0, -1), bytes.slice(-1)]), { headers: { "content-type": "text/event-stream" } }),
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  test("preserves UTF-8 bytes split inside a multibyte character", async () => {
    const value = 'data: {"type":"response.output_text.delta","delta":"é"}\n\n'
    const bytes = new TextEncoder().encode(value)
    const position = bytes.indexOf(0xc3)
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => new Response(byteStream([bytes.slice(0, position + 1), bytes.slice(position + 1)]), { headers: { "content-type": "text/event-stream" } }),
    })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  test("rejects a truly oversized first event", async () => {
    const bytes = new TextEncoder().encode(`data: ${"x".repeat(65 * 1024)}\n\n`)
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, { fetch: async () => responseBytes(bytes) })
    expect(response.status).toBe(200)
    await expect(response.text()).rejects.toBeInstanceOf(ProviderError.ResponseStreamError)
  })

  test("exhausts both SSE codes independently and keeps both final streams readable", async () => {
    for (const code of ["server_is_overloaded", "service_unavailable_error"] as const) {
      const value = `data: {"type":"error","code":"${code}"}\n\n`
      let calls = 0
      const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, { fetch: async () => { calls++; return sse(value) }, sleep: async () => {} })
      expect(calls).toBe(4)
      expect(await response.text()).toBe(value)
    }
  })

  test("aborting during signal-aware header wait prevents later attempts", async () => {
    const controller = new AbortController()
    let calls = 0
    const promise = fetchCodexHTTP("https://chatgpt.test/responses", { signal: controller.signal }, {
      fetch: async (_input, init) => {
        calls++
        await new Promise<void>((resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }))
        return sse(CREATED)
      }, headerTimeout: 100,
    })
    setTimeout(() => controller.abort(new Error("cancelled")), 10)
    await expect(promise).rejects.toThrow("cancelled")
    expect(calls).toBe(1)
  })

  test("aborting during first-event read prevents later attempts", async () => {
    const controller = new AbortController()
    let calls = 0
    const promise = fetchCodexHTTP("https://chatgpt.test/responses", { signal: controller.signal }, {
      fetch: async () => { calls++; return new Response(new ReadableStream({ pull() {} }), { headers: { "content-type": "text/event-stream" } }) }, chunkTimeout: 100,
    })
    setTimeout(() => controller.abort(new Error("read cancelled")), 10)
    await expect(promise).rejects.toThrow("read cancelled")
    expect(calls).toBe(1)
  })

  test("aborting during retry backoff prevents later attempts", async () => {
    const controller = new AbortController()
    let calls = 0
    const promise = fetchCodexHTTP("https://chatgpt.test/responses", { signal: controller.signal }, {
      fetch: async () => { calls++; return new Response("retry", { status: 503 }) }, sleep: (ms, signal) => new Promise<void>((resolve, reject) => signal?.addEventListener("abort", () => reject(signal.reason), { once: true })),
    })
    setTimeout(() => controller.abort(new Error("backoff cancelled")), 10)
    await expect(promise).rejects.toThrow("backoff cancelled")
    expect(calls).toBe(1)
  })

  test("chunk timeout rejects even when reader cancellation never settles", async () => {
    const promise = fetchCodexHTTP("https://chatgpt.test/responses", {}, { fetch: async () => new Response(new ReadableStream({ pull() {}, cancel() { return new Promise<void>(() => {}) } }), { headers: { "content-type": "text/event-stream" } }), chunkTimeout: 10 })
    await expect(promise).rejects.toBeInstanceOf(ProviderError.ResponseStreamError)
  })

  test("raw chunk activity resets the chunk timeout", async () => {
    const bytes = new TextEncoder().encode(CREATED)
    let index = 0
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, { fetch: async () => new Response(new ReadableStream({ async pull(controller) { if (index < bytes.length) { await new Promise((resolve) => setTimeout(resolve, 8)); controller.enqueue(bytes.slice(index, ++index)) } else controller.close() } }), { headers: { "content-type": "text/event-stream" } }), chunkTimeout: 15 })
    expect(await response.text()).toBe(CREATED)
  })

  test("preserves 401, 403, and 429 responses unchanged", async () => {
    for (const status of [401, 403, 429]) {
      const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, { fetch: async () => new Response(`body-${status}`, { status, headers: { "x-sentinel": "yes" } }) })
      expect(response.status).toBe(status); expect(response.headers.get("x-sentinel")).toBe("yes"); expect(await response.text()).toBe(`body-${status}`)
    }
  })

  test("preserves exhausted 502, 503, and 504 responses unchanged", async () => {
    for (const status of [502, 503, 504]) {
      const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, { fetch: async () => new Response(`final-${status}`, { status, headers: { "x-sentinel": "yes" } }), sleep: async () => {} })
      expect(response.status).toBe(status); expect(response.headers.get("x-sentinel")).toBe("yes"); expect(await response.text()).toBe(`final-${status}`)
    }
  })

  test("bounds malformed non-SSE preview and attempts cleanup", async () => {
    let cancelled = false
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, { fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("z".repeat(3000))) }, cancel() { cancelled = true } }), { status: 200, headers: { "content-type": "application/json", "content-length": "3000" } }), chunkTimeout: 10 })
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBeNull(); expect(cancelled).toBe(true)
    await expect(response.text()).rejects.toThrow(/application\/json.*z{1024}/)
  })

  test("consumer cancellation cancels upstream and prevents later reads", async () => {
    let reads = 0; let cancelled = false
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, { fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(CREATED)) }, pull() { reads++ }, cancel() { cancelled = true } }), { headers: { "content-type": "text/event-stream" } }) })
    const reader = response.body?.getReader(); await reader?.read(); await reader?.cancel(); expect(cancelled).toBe(true); const before = reads; await Promise.resolve(); expect(reads).toBe(before)
  })

  test("preserves a valid function and tool-call SSE sequence byte-for-byte", async () => {
    const value = 'data: {"type":"response.function_call_arguments.delta","delta":"{\\"x\\":1}"}\r\n\r\ndata: {"type":"response.output_item.done","item":{"type":"function_call"}}\r\n\r\n'
    const bytes = new TextEncoder().encode(value)
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, { fetch: async () => responseBytes(bytes) })
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  test("removes settled read abort listeners", async () => {
    const controller = new AbortController(); let listeners = 0
    const add = controller.signal.addEventListener.bind(controller.signal); const remove = controller.signal.removeEventListener.bind(controller.signal)
    controller.signal.addEventListener = ((...args: Parameters<typeof add>) => { listeners++; return add(...args) }) as typeof add
    controller.signal.removeEventListener = ((...args: Parameters<typeof remove>) => { listeners--; return remove(...args) }) as typeof remove
    const response = await fetchCodexHTTP("https://chatgpt.test/responses", { signal: controller.signal }, { fetch: async () => responseBytes(new TextEncoder().encode(CREATED)), chunkTimeout: 20 })
    await response.text(); controller.abort(); expect(listeners).toBe(0)
  })

  test("returns a typed response when malformed preview times out", async () => {
    let cancelled = false
    const promise = fetchCodexHTTP("https://chatgpt.test/responses", {}, {
      fetch: async () => new Response(new ReadableStream({ pull() {}, cancel() { cancelled = true; return new Promise<void>(() => {}) } }), { status: 200, headers: { "content-type": "text/plain" } }),
      chunkTimeout: 10,
    })
    const response = await promise
    expect(response.status).toBe(200)
    expect(cancelled).toBe(true)
    await expect(response.text()).rejects.toThrow(/text\/plain.*preview.*timed out/i)
  })

  test("caller abort during malformed preview rejects the outer request", async () => {
    const controller = new AbortController()
    const promise = fetchCodexHTTP("https://chatgpt.test/responses", { signal: controller.signal }, {
      fetch: async () => new Response(new ReadableStream({ pull() {} }), { status: 200, headers: { "content-type": "text/plain" } }),
      chunkTimeout: 100,
    })
    setTimeout(() => controller.abort(new Error("preview cancelled")), 10)
    await expect(promise).rejects.toThrow("preview cancelled")
  })
})
