import { test, expect } from "bun:test"
import { stripSkeinLoading, wrapSSE } from "@/provider/provider"
import { SkeinLoading } from "@/local/skein-loading"

const enc = new TextEncoder()

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c))
      ctrl.close()
    },
  })
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

/** SSE response that emits each [delayMs, chunk] pair on its own timer. */
function slowSseResponse(parts: Array<[number, string]>): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      for (const [delay, chunk] of parts) {
        await new Promise((r) => setTimeout(r, delay))
        ctrl.enqueue(enc.encode(chunk))
      }
      ctrl.close()
    },
  })
  return new Response(body, { headers: { "content-type": "text/event-stream" } })
}

async function readAll(res: Response): Promise<string> {
  return await new Response(res.body).text()
}

const loadingChunk = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: text } }], skein_loading: true })}\n\n`
const realChunk = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`

test("strips skein_loading deltas and forwards their text; keeps real deltas + [DONE]", async () => {
  const seen: string[] = []
  const res = sseResponse([
    loadingChunk("Filling the key-value cache…"),
    realChunk("Hello"),
    loadingChunk("Warming the tensors…"),
    realChunk(" world"),
    "data: [DONE]\n\n",
  ])
  const out = await readAll(stripSkeinLoading(res, (t) => seen.push(t)))

  // loading flavor must be gone from the wire the ai-sdk/persistence sees
  expect(out).not.toContain("skein_loading")
  expect(out).not.toContain("Filling the key-value cache")
  expect(out).not.toContain("Warming the tensors")
  // real content + terminator survive untouched
  expect(out).toContain(JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }))
  expect(out).toContain(JSON.stringify({ choices: [{ delta: { content: " world" } }] }))
  expect(out).toContain("[DONE]")
  // text is surfaced for live display
  expect(seen).toEqual(["Filling the key-value cache…", "Warming the tensors…"])
})

test("handles a skein_loading event split across stream chunks", async () => {
  const seen: string[] = []
  const full = loadingChunk("Coaxing the GPU awake…")
  const mid = Math.floor(full.length / 2)
  const res = sseResponse([full.slice(0, mid), full.slice(mid), realChunk("ok")])
  const out = await readAll(stripSkeinLoading(res, (t) => seen.push(t)))

  expect(out).not.toContain("skein_loading")
  expect(out).toContain(JSON.stringify({ choices: [{ delta: { content: "ok" } }] }))
  expect(seen).toEqual(["Coaxing the GPU awake…"])
})

// Genuine model thinking arrives as reasoning_content WITHOUT the skein_loading
// tag (llama-skein only tags its load-time flavor chatter — see loadingWriter in
// llama-skein internal/router/loading.go). The filter must never touch it, even
// when the reasoning text itself happens to mention "skein_loading" (defeating
// the cheap includes() pre-filter and forcing the JSON.parse path).
test("passes genuine untagged reasoning_content through untouched", async () => {
  const seen: string[] = []
  const reasoningChunk = (text: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: text } }] })}\n\n`
  const res = sseResponse([
    loadingChunk("Warming the tensors…"),
    reasoningChunk("Let me think about the skein_loading filter here."),
    reasoningChunk("Step 2: therefore the answer is 42."),
    realChunk("The answer is 42."),
    "data: [DONE]\n\n",
  ])
  const out = await readAll(stripSkeinLoading(res, (t) => seen.push(t)))

  expect(out).toContain("Let me think about the skein_loading filter here.")
  expect(out).toContain("Step 2: therefore the answer is 42.")
  expect(out).toContain(JSON.stringify({ choices: [{ delta: { content: "The answer is 42." } }] }))
  // only the tagged loading chunk was diverted
  expect(seen).toEqual(["Warming the tensors…"])
  expect(out).not.toContain("Warming the tensors")
})

// The chunk timer watches the RAW stream (wrapSSE first, strip after) so that
// a cold model load — which streams only skein_loading flavor chunks — counts
// as liveness by design. (Strip-first only stayed alive by accident: the strip
// leaks each dropped event's trailing blank separator line downstream, and
// those stray newlines reset the timer. Do not rely on that.)
test("loading-only traffic keeps the chunk timer alive when wrapSSE wraps the raw stream", async () => {
  const seen: string[] = []
  const raw = slowSseResponse([
    [10, loadingChunk("Filling the key-value cache…")],
    [60, loadingChunk("Warming the tensors…")],
    [60, loadingChunk("Nearly there…")],
    [60, realChunk("Hello")],
    [10, "data: [DONE]\n\n"],
  ])
  // chunk timeout (100ms) is longer than any single gap (60ms) but far shorter
  // than the total loading phase (~180ms).
  const ctl = new AbortController()
  const wrapped = wrapSSE(raw, 100, ctl)
  const out = await readAll(stripSkeinLoading(wrapped, (t) => seen.push(t)))

  expect(out).toContain(JSON.stringify({ choices: [{ delta: { content: "Hello" } }] }))
  expect(out).not.toContain("skein_loading")
  expect(seen.length).toBe(3)
  expect(ctl.signal.aborted).toBe(false)
})

test("a genuinely dead raw stream is still killed by the chunk timer", async () => {
  const raw = slowSseResponse([
    [10, loadingChunk("a…")],
    [300, realChunk("too late")],
  ])
  const ctl = new AbortController()
  const wrapped = stripSkeinLoading(wrapSSE(raw, 100, ctl))
  await expect(readAll(wrapped)).rejects.toThrow()
  expect(ctl.signal.aborted).toBe(true)
})

// The stream-inactivity watchdog (llm.ts) uses this stamp to tell "a model is
// cold-loading somewhere" from "the stream is dead" — loading chunks never
// become LLM events, so without it a long load reads as a stalled stream.
test("stripped loading deltas stamp SkeinLoading.activeWithin", async () => {
  const res = sseResponse([loadingChunk("Spinning up…"), realChunk("hi")])
  await readAll(stripSkeinLoading(res, (t) => SkeinLoading.emit(t)))
  expect(SkeinLoading.activeWithin(5_000)).toBe(true)
  expect(SkeinLoading.activeWithin(0)).toBe(false)
})

test("passes a non-SSE response through unchanged", async () => {
  const res = new Response("not a stream", { headers: { "content-type": "application/json" } })
  expect(await readAll(stripSkeinLoading(res))).toBe("not a stream")
})
