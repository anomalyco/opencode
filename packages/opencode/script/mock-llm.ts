const num = (input: string | undefined | null, fallback: number) => {
  if (input == null || input === "") return fallback
  const parsed = Number(input)
  if (Number.isFinite(parsed)) return parsed
  return fallback
}

const port = num(Bun.env.MOCK_LLM_PORT, 8787)
const delay = num(Bun.env.MOCK_LLM_DELAY_MS, 0)
const slow = num(Bun.env.MOCK_LLM_SLOW_CALLS, 0)
const gap = num(Bun.env.MOCK_LLM_STREAM_GAP_MS, 20)
const stall = num(Bun.env.MOCK_LLM_STALL_MS, 0)
const stallAfter = num(Bun.env.MOCK_LLM_STALL_AFTER, stall > 0 ? 1 : 0)
const text = Bun.env.MOCK_LLM_TEXT ?? "mock reply"

const calls = { value: 0 }

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "*",
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      ...cors,
    },
  })

const stream = (chunks: Array<Record<string, unknown>>) => {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    async start(controller) {
      for (const [index, chunk] of chunks.entries()) {
        if (stall > 0 && index === stallAfter) await Bun.sleep(stall)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        if (gap > 0) await Bun.sleep(gap)
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...cors,
    },
  })
}

const wait = async (req: Request, url: URL, count: number) => {
  const query = url.searchParams.get("delay")
  const header = req.headers.get("x-mock-delay")
  const override = num(query ?? header, Number.NaN)
  const base = count <= slow ? delay : 0
  const ms = Number.isFinite(override) ? override : base
  if (ms > 0) await Bun.sleep(ms)
}

const chat = async (req: Request, url: URL, count: number) => {
  await wait(req, url, count)
  const body = await req.json().catch(() => ({}))
  const model = typeof body.model === "string" ? body.model : "mock"
  const created = Math.floor(Date.now() / 1000)
  const id = `chatcmpl_mock_${count}`
  const shouldStream = body.stream === true

  if (shouldStream) {
    const chunks = [
      {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      },
      {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      },
    ]
    return stream(chunks)
  }

  return json({
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })
}

const responses = async (req: Request, url: URL, count: number) => {
  await wait(req, url, count)
  const body = await req.json().catch(() => ({}))
  const model = typeof body.model === "string" ? body.model : "mock"
  const created = Math.floor(Date.now() / 1000)
  const id = `resp_mock_${count}`
  const item = `item_${count}`
  const shouldStream = body.stream === true

  if (shouldStream) {
    const chunks = [
      {
        type: "response.created",
        response: { id, created_at: created, model, service_tier: null },
      },
      {
        type: "response.output_text.delta",
        item_id: item,
        delta: text,
        logprobs: null,
      },
      {
        type: "response.completed",
        response: {
          incomplete_details: null,
          usage: {
            input_tokens: 1,
            input_tokens_details: { cached_tokens: null },
            output_tokens: 1,
            output_tokens_details: { reasoning_tokens: null },
          },
          service_tier: null,
        },
      },
    ]
    return stream(chunks)
  }

  return json({
    id,
    created_at: created,
    model,
    error: null,
    output: [
      {
        type: "message",
        role: "assistant",
        id: `msg_${count}`,
        content: [
          {
            type: "output_text",
            text,
            logprobs: null,
            annotations: [],
          },
        ],
      },
    ],
  })
}

const server = Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url)
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors })

    if (url.pathname === "/health") return json({ ok: true, calls: calls.value })
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return json({ data: [{ id: "mock", object: "model" }], object: "list" })
    }

    if (req.method !== "POST") return json({ error: { message: "Method not allowed" } }, 405)

    calls.value += 1

    if (url.pathname === "/v1/chat/completions") {
      return chat(req, url, calls.value)
    }
    if (url.pathname === "/v1/responses") {
      return responses(req, url, calls.value)
    }

    return json({ error: { message: "Not found" } }, 404)
  },
})

console.log(
  JSON.stringify(
    {
      service: "mock-llm",
      url: server.url.href,
      port,
      delay,
      slow,
      gap,
      stall,
      stallAfter,
      text,
    },
    null,
    2,
  ),
)
