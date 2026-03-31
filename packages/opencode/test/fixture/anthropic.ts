/**
 * Fake Anthropic HTTP server for E2E tests that need real AI SDK streamText.
 *
 * Usage:
 *   import { server, waitRequest, toolResponse, textResponse, deferred } from "../fixture/anthropic"
 *
 *   beforeAll(() => server.start())
 *   beforeEach(() => server.reset())
 *   afterAll(() => server.stop())
 *
 *   // In test:
 *   waitRequest("/messages", toolResponse("toolu_01", "my_tool", { key: "value" }))
 *   waitRequest("/messages", textResponse("Done"))
 */

export type Capture = {
  url: URL
  headers: Headers
  body: Record<string, unknown>
}

type Entry = {
  path: string
  response: Response | ((req: Request, capture: Capture) => Response)
  resolve: (value: Capture) => void
}

const state = {
  instance: null as ReturnType<typeof Bun.serve> | null,
  queue: [] as Entry[],
}

export function deferred<T>() {
  const result = {} as { promise: Promise<T>; resolve: (value: T) => void }
  result.promise = new Promise((resolve) => {
    result.resolve = resolve
  })
  return result
}

export const server = {
  start() {
    state.instance = Bun.serve({
      port: 0,
      async fetch(req) {
        const next = state.queue.shift()
        if (!next) return new Response("unexpected request", { status: 500 })
        const url = new URL(req.url)
        const body = (await req.json()) as Record<string, unknown>
        next.resolve({ url, headers: req.headers, body })
        if (!url.pathname.endsWith(next.path)) return new Response("not found", { status: 404 })
        return typeof next.response === "function"
          ? next.response(req, { url, headers: req.headers, body })
          : next.response
      },
    })
  },
  stop() {
    state.instance?.stop()
  },
  reset() {
    state.queue.length = 0
  },
  get origin() {
    if (!state.instance) throw new Error("server.start() must be called before accessing origin")
    return state.instance.url.origin
  },
}

export function waitRequest(pathname: string, response: Response | ((req: Request, capture: Capture) => Response)) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}

// --- SSE helpers ---

export function sse(chunks: unknown[]) {
  const payload = chunks.map((c) => `data: ${JSON.stringify(c)}`).join("\n\n") + "\n\n"
  const bytes = new TextEncoder().encode(payload)
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  )
}

export function toolResponse(id: string, name: string, input: Record<string, unknown>) {
  return sse([
    {
      type: "message_start",
      message: {
        id: "msg-1",
        model: "claude-3-5-sonnet-20241022",
        role: "assistant",
        usage: { input_tokens: 10, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    },
    { type: "message_stop" },
  ])
}

export function textResponse(msg: string) {
  return sse([
    {
      type: "message_start",
      message: {
        id: "msg-2",
        model: "claude-3-5-sonnet-20241022",
        role: "assistant",
        usage: { input_tokens: 10, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: msg } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    },
    { type: "message_stop" },
  ])
}
