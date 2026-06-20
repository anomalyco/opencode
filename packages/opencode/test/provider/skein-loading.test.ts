import { test, expect } from "bun:test"
import { stripSkeinLoading } from "@/provider/provider"

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

test("passes a non-SSE response through unchanged", async () => {
  const res = new Response("not a stream", { headers: { "content-type": "application/json" } })
  expect(await readAll(stripSkeinLoading(res))).toBe("not a stream")
})
