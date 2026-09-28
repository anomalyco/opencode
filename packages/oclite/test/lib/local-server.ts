// The one sanctioned test double (ARCHITECTURE §14): a Bun.serve OpenAI-compatible fake, reachable from
// subprocesses. Idea from packages/opencode/test/lib/llm-server.ts (scripted reply queue); not imported.
//
//   const server = await startLocalServer({ tools: "text" })   // or `await using server = ...`
//   server.url                          // "http://127.0.0.1:PORT/v1"
//   server.queue(reply.text("hi"))      // each argument is ONE response ...
//   server.queue([reply.reasoning("hmm"), reply.tool_call({ name: "read", args: { path: "a" } })]) // ... an array composes one
//   server.set({ fail_status: { code: 503, times: 1 } })
//   server.requests                     // every request, in order (chat, models, tokenize, 404s)
//   server.chats()                      // only POST /v1/chat/completions
//   await server.stop()
//
// Routes: GET /v1/models, POST /v1/chat/completions (stream true|false), POST /tokenize (llama.cpp style).
// An empty queue answers text "ok".
//
// Checks on a chat request run in this order: hang → fail_status → reject_params → context_limit → prefill
// delay → scripted reply. Only the scripted-reply step consumes the queue, so a fail_status retry receives the
// reply that was queued. A drop_after_chunks stream puts its reply back at the front of the queue. Limitation:
// Bun.serve cannot reset a connection, so a drop is an early clean EOF (no finish_reason, no [DONE]), not ECONNRESET.
//
// Token accounting is deterministic: prompt_tokens = ceil(render(body).length / 4), where render() is the
// system text, then the tools JSON, then every other message as JSON (see `render` below; tests may import
// it). completion_tokens = ceil(chars of content + reasoning + tool arguments / 4).
//
// Reasoning placement: think_tags=true → inline `<think>…</think>` in content; else reasoning_field names the
// delta field; reasoning_field "none" drops it. reply.think() is always inline.
//
// Prefill: before the first byte the server sleeps prefill_ms_per_kchar ms per 1000 rendered chars (cap 250 ms).
// With prefix_cache=true the share of the prompt that repeats a previous request's prefix is 80% cheaper.

export type Toggles = {
  model: string
  models: "vllm" | "llamacpp" | "lmstudio" | "none"
  context_window: number
  usage_in_stream: boolean
  reasoning_field: "reasoning_content" | "reasoning" | "none"
  think_tags: boolean
  tools: "native" | "text"
  /** Format used to render reply.tool_call() as content when tools is "text". */
  text_tool_format: TextToolFormat
  reject_params: string[]
  prefix_cache: boolean
  prefill_ms_per_kchar: number
  context_limit?: number
  fail_status?: { code: number; times: number }
  drop_after_chunks?: number
  hang: boolean
  tokenize: boolean
  chunk_delay_ms: number
  /** Max characters per streamed delta; small values split words and `<think>` tags across deltas. */
  delta_chars: number
}

export type TextToolFormat = "fenced" | "bare" | "hermes"

export type Reply =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "think"; text: string }
  | { type: "tool_call"; name: string; args: unknown; id?: string }
  | { type: "text_tool_call"; name: string; args: unknown; format: TextToolFormat }
  | { type: "malformed_tool_call"; text: string }
  | { type: "finish"; reason: string }
  | { type: "error"; status: number; body: unknown }

export const reply = {
  text: (text: string): Reply => ({ type: "text", text }),
  reasoning: (text: string): Reply => ({ type: "reasoning", text }),
  think: (text: string): Reply => ({ type: "think", text }),
  tool_call: (input: { name: string; args: unknown; id?: string }): Reply => ({ type: "tool_call", ...input }),
  text_tool_call: (input: { name: string; args: unknown; format?: TextToolFormat }): Reply => ({
    type: "text_tool_call",
    name: input.name,
    args: input.args,
    format: input.format ?? "fenced",
  }),
  /** Emitted verbatim as content. */
  malformed_tool_call: (text: string): Reply => ({ type: "malformed_tool_call", text }),
  /** Overrides finish_reason, e.g. "length". */
  finish: (reason: string): Reply => ({ type: "finish", reason }),
  /** The whole response becomes this HTTP status with this JSON body. */
  error: (status: number, body: unknown): Reply => ({ type: "error", status, body }),
}

export type ChatMessage = { role: string; content?: unknown; [key: string]: unknown }

export type ChatBody = {
  model?: string
  messages?: ChatMessage[]
  tools?: unknown[]
  stream?: boolean
  stream_options?: { include_usage?: boolean }
  max_tokens?: number
  prompt_cache_key?: string
  [key: string]: unknown
}

export type LoggedRequest = {
  method: string
  path: string
  headers: Record<string, string>
  body?: ChatBody
  receivedAt: number
  /** Response status; undefined while hanging. */
  status?: number
  firstByteAt?: number
  doneAt?: number
  /** SSE chunks as sent: the parsed JSON payload (or "[DONE]") and the epoch ms it was enqueued. */
  chunks: Array<{ at: number; data: unknown }>
  /** True when drop_after_chunks cut this stream short. */
  dropped?: boolean
  /** How long the simulated prefill slept. */
  prefillMs?: number
}

export type LocalServer = Awaited<ReturnType<typeof startLocalServer>>

const defaults: Toggles = {
  model: "test-model",
  models: "vllm",
  context_window: 32768,
  usage_in_stream: true,
  reasoning_field: "reasoning_content",
  think_tags: false,
  tools: "native",
  text_tool_format: "fenced",
  reject_params: [],
  prefix_cache: true,
  prefill_ms_per_kchar: 5,
  hang: false,
  tokenize: false,
  chunk_delay_ms: 0,
  delta_chars: 4,
}

export async function startLocalServer(options: Partial<Toggles> = {}) {
  const toggles: Toggles = { ...defaults, ...options }
  const pending: Array<Reply[]> = []
  const requests: LoggedRequest[] = []
  const prompts: string[] = []
  const hangs = new Set<() => void>()

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    // Hang and slow-chunk tests hold connections open far longer than Bun's 10 s default.
    idleTimeout: 0,
    fetch: async (req) => {
      const url = new URL(req.url)
      const log: LoggedRequest = {
        method: req.method,
        path: url.pathname,
        headers: Object.fromEntries(req.headers.entries()),
        receivedAt: Date.now(),
        chunks: [],
      }
      requests.push(log)
      const text = await req.text()
      log.body = text ? await new Response(text).json().then(asBody, () => undefined) : undefined
      const res = await route(req, log)
      log.status = res.status
      if (!res.headers.get("content-type")?.includes("event-stream")) log.firstByteAt = log.doneAt = Date.now()
      return res
    },
  })

  async function route(req: Request, log: LoggedRequest) {
    if (req.method === "GET" && log.path === "/v1/models") return models(toggles)
    if (req.method === "POST" && log.path === "/tokenize" && toggles.tokenize)
      return Response.json({ tokens: Array.from({ length: estimate(String(log.body?.content ?? "")) }, (_, i) => i) })
    if (req.method === "POST" && log.path === "/v1/chat/completions") return chat(req, log)
    return Response.json({ error: { message: `not found: ${req.method} ${log.path}` } }, { status: 404 })
  }

  async function chat(req: Request, log: LoggedRequest) {
    const body = log.body ?? {}
    if (toggles.hang)
      return new Promise<Response>((resolve) => {
        const release = () => {
          hangs.delete(release)
          resolve(new Response(null, { status: 499 }))
        }
        hangs.add(release)
        req.signal.addEventListener("abort", release)
      })
    if (toggles.fail_status && toggles.fail_status.times > 0) {
      toggles.fail_status = { ...toggles.fail_status, times: toggles.fail_status.times - 1 }
      return failure(toggles.fail_status.code, `simulated ${toggles.fail_status.code}`)
    }
    const rejected = toggles.reject_params.filter((param) => param in body)
    if (rejected.length) return failure(400, `Unrecognized request argument supplied: ${rejected.join(", ")}`)
    const prompt = render(body)
    const promptTokens = estimate(prompt)
    if (toggles.context_limit !== undefined && promptTokens > toggles.context_limit)
      return failure(
        400,
        `This model's maximum context length is ${toggles.context_limit} tokens. However, you requested ${promptTokens} tokens (${promptTokens} in the messages, ${body.max_tokens ?? 0} in the completion). Please reduce the length of the messages or completion.`,
      )
    log.prefillMs = prefill(prompt, prompts, toggles)
    prompts.push(prompt)
    if (log.prefillMs > 0) await Bun.sleep(log.prefillMs)

    const parts = pending.shift() ?? [reply.text("ok")]
    const error = parts.find((part) => part.type === "error")
    if (error) return Response.json(error.body, { status: error.status })
    const plan = compose(parts, toggles)
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: estimate(plan.output),
      total_tokens: promptTokens + estimate(plan.output),
    }
    const model = body.model ?? toggles.model
    if (!body.stream) return Response.json(completion(plan, usage, model))
    return sse(req, log, plan, body.stream_options?.include_usage && toggles.usage_in_stream ? usage : undefined, model, parts)
  }

  function sse(req: Request, log: LoggedRequest, plan: Plan, usage: Usage | undefined, model: string, parts: Reply[]) {
    const created = Math.floor(Date.now() / 1000)
    const chunk = (choices: unknown[], extra?: Record<string, unknown>) => ({
      id: "chatcmpl-local",
      object: "chat.completion.chunk",
      created,
      model,
      choices,
      ...extra,
    })
    const payloads: unknown[] = [
      chunk([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }]),
      ...plan.deltas.map((delta) => chunk([{ index: 0, delta, finish_reason: null }])),
      chunk([{ index: 0, delta: {}, finish_reason: plan.finish }]),
      ...(usage ? [chunk([], { usage })] : []),
      "[DONE]",
    ]
    const drop = toggles.drop_after_chunks
    if (drop !== undefined) toggles.drop_after_chunks = undefined
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        for (const [index, data] of payloads.entries()) {
          if (index > 0 && toggles.chunk_delay_ms > 0) await Bun.sleep(toggles.chunk_delay_ms)
          if (req.signal.aborted) return
          if (drop !== undefined && index >= drop) {
            // Bun.serve cannot reset a socket, and controller.error() reaches a Bun fetch client as a clean EOF
            // anyway, so a drop is a body that ends without finish_reason and without [DONE].
            pending.unshift(parts)
            log.dropped = true
            controller.close()
            return
          }
          const at = Date.now()
          log.firstByteAt ??= at
          log.chunks.push({ at, data })
          controller.enqueue(encoder.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`))
        }
        log.doneAt = Date.now()
        controller.close()
      },
    })
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    })
  }

  const stop = async () => {
    ;[...hangs].forEach((release) => release())
    await server.stop(true)
  }

  return {
    url: `http://127.0.0.1:${server.port}/v1`,
    origin: `http://127.0.0.1:${server.port}`,
    requests,
    chats: () => requests.filter((item) => item.method === "POST" && item.path === "/v1/chat/completions"),
    queue: (...responses: Array<Reply | Reply[]>) => {
      pending.push(...responses.map((item) => (Array.isArray(item) ? item : [item])))
    },
    /** Responses still queued. */
    pending: () => pending.length,
    toggles: () => ({ ...toggles }),
    set: (input: Partial<Toggles>) => {
      Object.assign(toggles, input)
    },
    stop,
    [Symbol.asyncDispose]: stop,
  }
}

/** The text the fake "tokenizes": system text, then tools JSON, then every other message as JSON. */
export function render(body: ChatBody) {
  const messages = body.messages ?? []
  return [
    ...messages.filter((item) => item.role === "system").map((item) => contentText(item.content)),
    JSON.stringify(body.tools ?? []),
    ...messages.filter((item) => item.role !== "system").map((item) => JSON.stringify(item)),
  ].join("\n")
}

/** ceil(chars / 4), the fake's token count for any text. */
export function estimate(text: string) {
  return Math.ceil(text.length / 4)
}

/** prompt_tokens the fake reports for this request body. */
export function countTokens(body: ChatBody) {
  return estimate(render(body))
}

/** Renders a tool call the way a text-protocol model would write it. */
export function renderTextToolCall(name: string, args: unknown, format: TextToolFormat) {
  if (format === "hermes") return `<tool_call>\n${JSON.stringify({ name, arguments: args })}\n</tool_call>`
  const json = JSON.stringify({ tool: name, args })
  if (format === "bare") return json
  return "```json\n" + json + "\n```"
}

type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number }

type Segment =
  | { kind: "content"; text: string }
  | { kind: "reasoning"; field: string; text: string }
  | { kind: "tool"; index: number; id: string; name: string; args: string }

type Plan = ReturnType<typeof compose>

function compose(parts: Reply[], toggles: Toggles) {
  const segments = parts.reduce<Segment[]>((acc, part) => {
    const next = segment(part, toggles, acc.filter((item) => item.kind === "tool").length)
    if (!next) return acc
    const last = acc.at(-1)
    // Adjacent content merges so deltas can straddle `</think>` and the text after it, like a real stream.
    if (next.kind === "content" && last?.kind === "content") return [...acc.slice(0, -1), { ...last, text: last.text + next.text }]
    return [...acc, next]
  }, [])
  const finish = parts.findLast((part) => part.type === "finish")
  const tools = segments.filter((item) => item.kind === "tool")
  return {
    segments,
    deltas: segments.flatMap((item) => deltas(item, toggles.delta_chars)),
    finish: finish?.type === "finish" ? finish.reason : tools.length ? "tool_calls" : "stop",
    output: segments.map((item) => (item.kind === "tool" ? item.name + item.args : item.text)).join(""),
  }
}

function segment(part: Reply, toggles: Toggles, toolIndex: number): Segment | undefined {
  if (part.type === "text" || part.type === "malformed_tool_call") return { kind: "content", text: part.text }
  if (part.type === "think") return { kind: "content", text: `<think>${part.text}</think>` }
  if (part.type === "reasoning") {
    if (toggles.think_tags) return { kind: "content", text: `<think>${part.text}</think>` }
    if (toggles.reasoning_field === "none") return
    return { kind: "reasoning", field: toggles.reasoning_field, text: part.text }
  }
  if (part.type === "text_tool_call")
    return { kind: "content", text: renderTextToolCall(part.name, part.args, part.format) }
  if (part.type === "tool_call") {
    if (toggles.tools === "text")
      return { kind: "content", text: renderTextToolCall(part.name, part.args, toggles.text_tool_format) }
    return {
      kind: "tool",
      index: toolIndex,
      id: part.id ?? `call_${toolIndex}_${part.name}`,
      name: part.name,
      args: JSON.stringify(part.args),
    }
  }
}

function deltas(item: Segment, size: number): Record<string, unknown>[] {
  if (item.kind === "content") return pieces(item.text, size).map((text) => ({ content: text }))
  if (item.kind === "reasoning") return pieces(item.text, size).map((text) => ({ [item.field]: text }))
  // Name and id arrive first with empty arguments, then the arguments JSON in about three pieces.
  return [
    { tool_calls: [{ index: item.index, id: item.id, type: "function", function: { name: item.name, arguments: "" } }] },
    ...pieces(item.args, Math.max(1, Math.ceil(item.args.length / 3))).map((args) => ({
      tool_calls: [{ index: item.index, function: { arguments: args } }],
    })),
  ]
}

function pieces(text: string, size: number) {
  return Array.from({ length: Math.ceil(text.length / size) }, (_, i) => text.slice(i * size, (i + 1) * size))
}

function completion(plan: Plan, usage: Usage, model: string) {
  const content = plan.segments.flatMap((item) => (item.kind === "content" ? [item.text] : [])).join("")
  const reasoning = plan.segments.flatMap((item) => (item.kind === "reasoning" ? [item] : []))
  const tools = plan.segments.flatMap((item) => (item.kind === "tool" ? [item] : []))
  return {
    id: "chatcmpl-local",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          ...(reasoning.length ? { [reasoning[0].field]: reasoning.map((item) => item.text).join("") } : {}),
          ...(tools.length
            ? {
                tool_calls: tools.map((item) => ({
                  id: item.id,
                  type: "function",
                  function: { name: item.name, arguments: item.args },
                })),
              }
            : {}),
        },
        finish_reason: plan.finish,
      },
    ],
    usage,
  }
}

function models(toggles: Toggles) {
  if (toggles.models === "none") return Response.json({ error: { message: "not found" } }, { status: 404 })
  const base = { id: toggles.model, object: "model", created: 1700000000 }
  if (toggles.models === "vllm")
    return Response.json({
      object: "list",
      data: [{ ...base, owned_by: "vllm", root: toggles.model, max_model_len: toggles.context_window }],
    })
  if (toggles.models === "lmstudio")
    return Response.json({
      object: "list",
      data: [{ ...base, owned_by: "organization_owner", context_length: toggles.context_window }],
    })
  return Response.json({
    object: "list",
    data: [{ ...base, owned_by: "llamacpp", meta: { n_ctx_train: toggles.context_window, n_vocab: 32000 } }],
  })
}

function failure(status: number, message: string) {
  return Response.json(
    { object: "error", error: { message, type: status === 400 ? "BadRequestError" : "ServerError", code: status } },
    { status },
  )
}

function prefill(prompt: string, previous: string[], toggles: Toggles) {
  const full = Math.min(250, (prompt.length / 1000) * toggles.prefill_ms_per_kchar)
  if (!toggles.prefix_cache || prompt.length === 0) return full
  const cached = Math.max(0, ...previous.map((item) => commonPrefix(item, prompt)))
  return full * (1 - 0.8 * (cached / prompt.length))
}

function commonPrefix(a: string, b: string) {
  const limit = Math.min(a.length, b.length)
  const index = Array.from({ length: limit }).findIndex((_, i) => a[i] !== b[i])
  return index === -1 ? limit : index
}

function contentText(content: unknown) {
  if (typeof content === "string") return content
  return JSON.stringify(content ?? "")
}

function asBody(value: unknown): ChatBody | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as ChatBody
  return undefined
}
