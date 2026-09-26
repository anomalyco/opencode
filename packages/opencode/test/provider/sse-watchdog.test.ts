import { describe, expect, test } from "bun:test"
import { wrapSSE } from "../../src/provider/provider"
import { ProviderError } from "../../src/provider/error"

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function sse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("provider.wrapSSE idle watchdog", () => {
  test("does not abort while a downstream consumer is idle and upstream has data buffered", async () => {
    const ctl = new AbortController()
    const body = sse(
      new ReadableStream<Uint8Array>({
        start(ctrl) {
          for (let i = 0; i < 50; i++) ctrl.enqueue(encoder.encode(`data: ${i}\n\n`))
          ctrl.close()
        },
      }),
    )
    const reader = wrapSSE(body, 25, ctl).body!.getReader()

    expect(decoder.decode((await reader.read()).value)).toContain("data: 0")
    await sleep(120)

    expect(ctl.signal.aborted).toBe(false)
    expect(decoder.decode((await reader.read()).value)).toContain("data: 1")
  })

  test("aborts and errors the stream when the upstream body stalls", async () => {
    const ctl = new AbortController()
    const body = sse(
      new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.enqueue(encoder.encode("data: first\n\n"))
        },
      }),
    )
    const reader = wrapSSE(body, 25, ctl).body!.getReader()

    expect(decoder.decode((await reader.read()).value)).toContain("data: first")
    const next = await reader.read().then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(ctl.signal.aborted).toBe(true)
    expect(next).toBeInstanceOf(ProviderError.ResponseStreamError)
  })
})
