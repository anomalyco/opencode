// LlmGateway (ARCHITECTURE §3, §5, §9, §10): model resolution, capability-driven request shaping, the vLLM
// `delta.reasoning` fetch shim, usage estimation, the process-wide per-server queue and the <think> splitter.
import { Effect, Layer, Option, Schema, Semaphore, Stream } from "effect"
import { FetchHttpClient, type HttpClient } from "effect/unstable/http"
import { Auth, LLM, LLMClient, LLMError, type LLMEvent, type LLMRequest, Message, ProviderInternalReason, Usage } from "@opencode-ai/llm"
import { RequestExecutor } from "@opencode-ai/llm/route"
import { AppConfig, ConfigError, LlmGateway, type ModelHandle, type ResolvedConfig, type TokenUsage, type TurnRequest } from "../contract"
import { isLoopback } from "../util/paths"
import { redactUrl } from "../util/redact"
import { type CapabilityRecord, OPTIONAL, persist, probe, staticRecord } from "./probe"
import { splitThink } from "./think"

type Queue = { semaphore: Semaphore.Semaphore; size: number; holders: string[] }

// Process-wide on purpose: every gateway instance (main, sub-agents, side calls, probe) shares one queue per server.
const queues = new Map<string, Queue>()
const notices = new Set<string>()
const COMPATIBLE = "openai-compatible-chat"

const make = Effect.gen(function* () {
  const cfg = yield* AppConfig
  const client = yield* LLMClient.Service
  const handles = new Map<string, ModelHandle>()

  const resolve = (ref: string, opts?: { reprobe?: boolean }) =>
    Effect.gen(function* () {
      const cached = handles.get(ref)
      if (cached && !opts?.reprobe) return cached
      const handle = yield* resolveModel(cfg, ref, opts?.reprobe ?? false)
      handles.set(ref, handle)
      return handle
    })

  const attempt = (handle: ModelHandle, req: TurnRequest, retry: boolean): Stream.Stream<LLMEvent, LLMError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const caps = handle.capabilities
        const request = build(handle, req, effort(cfg, handle.ref))
        const input = caps.usage_in_stream ? 0 : yield* estimateInput(handle, request)
        const seen = { finish: false, out: 0 }
        const base = client.stream(request).pipe(
          caps.reasoning_field === "reasoning" ? Stream.provideService(FetchHttpClient.Fetch, renameReasoning(globalThis.fetch)) : (s) => s,
        )
        return (caps.think_tags && caps.reasoning_field === "none" ? splitThink(base) : base).pipe(
          Stream.tap((event) =>
            Effect.sync(() => {
              if (event.type === "finish") seen.finish = true
              if (event.type === "text-delta" || event.type === "reasoning-delta" || event.type === "tool-input-delta") seen.out += event.text.length
            }),
          ),
          Stream.map((event): LLMEvent => {
            if (caps.usage_in_stream || (event.type !== "finish" && event.type !== "step-finish")) return event
            const output = Math.ceil(seen.out / 4)
            return { ...event, usage: new Usage({ inputTokens: input, outputTokens: output, totalTokens: input + output, providerMetadata: { oclite: { estimated: true } } }) }
          }),
          // Bun.serve fakes and some proxies end a dropped stream with a clean EOF: treat "no finish" as a retryable drop.
          Stream.concat(Stream.suspend(() => (seen.finish ? Stream.empty : Stream.fail(new LLMError({ module: "oclite/llm", method: "stream",
            reason: new ProviderInternalReason({ status: 0, message: `stream from ${redactUrl(handle.baseURL)} ended without finish_reason (connection dropped)` }) }))))),
          Stream.catch((error: LLMError) => {
            const params = retry ? rejectedParams(error, request) : []
            if (!params.length) return Stream.fail(error)
            params.forEach((param) => (caps.accepts[param] = false))
            const patch = { accepts: Object.fromEntries(params.map((param) => [param, false])) }
            return Stream.unwrap(persist(handle.baseURL, handle.model.id, patch, "error-400").pipe(Effect.as(attempt(handle, req, false))))
          }),
        )
      }),
    )

  return LlmGateway.of({
    resolve,
    stream: (handle, req) =>
      Stream.unwrap(
        Effect.gen(function* () {
          yield* permit(queueFor(handle.baseURL, cfg.servers[handle.baseURL]?.concurrency ?? handle.capabilities.concurrency), req.label, req.onQueued)
          return attempt(handle, req, true)
        }),
      ),
    notice: (key) => Effect.sync(() => !notices.has(key) && Boolean(notices.add(key))),
  })

  function estimateInput(handle: ModelHandle, request: LLMRequest) {
    return Effect.gen(function* () {
      const prepared = yield* client.prepare(request).pipe(Effect.option)
      const text = Option.match(prepared, { onNone: () => request.system.map((part) => part.text).join("\n"), onSome: (value) => render(value.body) })
      if (!handle.capabilities.tokenize) return Math.ceil(text.length / 4)
      return yield* Effect.promise(() => tokenize(handle.baseURL, text).catch(() => Math.ceil(text.length / 4)))
    })
  }
})

/** `http` is FetchHttpClient.layer in production; tests may pass another HttpClient layer. */
export function layerWith(http: Layer.Layer<HttpClient.HttpClient>) {
  return Layer.effect(LlmGateway, make).pipe(
    Layer.provide(LLMClient.layer.pipe(Layer.provide(RequestExecutor.layer), Layer.provide(http))),
  )
}

export const layer = layerWith(FetchHttpClient.layer)

function resolveModel(cfg: ResolvedConfig, ref: string, reprobe: boolean) {
  return Effect.gen(function* () {
    const [providerID, modelID] = [ref.slice(0, Math.max(0, ref.indexOf("/"))), ref.slice(ref.indexOf("/") + 1)]
    if (!providerID) return yield* new ConfigError({ message: `model "${ref}" must be provider/model` })
    const entry = cfg.provider[providerID] ?? {}
    const options = entry.options ?? {}
    const limits = entry.models?.[modelID]
    const base = options.baseURL?.replace(/\/+$/, "")
    const pins = base ? cfg.servers[base] : undefined
    const hosted = providerID === "anthropic" || entry.npm === "@ai-sdk/anthropic" ? "anthropic" : providerID === "openai" && !base ? "openai" : undefined
    if (!hosted && !base) return yield* new ConfigError({ message: `provider "${providerID}" has no options.baseURL and is not anthropic/openai` })
    const baseURL = base ?? (hosted === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1")
    const model = yield* Effect.promise(() => modelFor(hosted, { baseURL: base, apiKey: options.apiKey, headers: options.headers, provider: providerID }, modelID))
    const capabilities: CapabilityRecord = hosted
      ? staticRecord(baseURL, modelID, { ...pins, context_window: pins?.context_window ?? limits?.limit?.context })
      : yield* Effect.scoped(
          permit(queueFor(baseURL, pins?.concurrency ?? pins?.capabilities?.concurrency ?? (isLoopback(baseURL) ? 1 : 8)), "probe", () => Effect.void).pipe(
            Effect.andThen(probe({ baseURL, model: modelID, apiKey: options.apiKey, headers: options.headers, reprobe,
              pins: { ...pins, context_window: pins?.context_window ?? limits?.limit?.context } })),
          ),
        )
    const reasoning = limits?.reasoning ?? (!hosted && (capabilities.reasoning_field !== "none" || capabilities.think_tags))
    return {
      ref, model, baseURL, capabilities, reasoning,
      local: !hosted && isLoopback(baseURL),
      contextWindow: capabilities.context_window,
      maxTokens: pins?.max_tokens ?? Math.max(reasoning ? 8192 : 0, limits?.limit?.output ?? 4096),
    } satisfies ModelHandle
  })
}

async function modelFor(hosted: "anthropic" | "openai" | undefined, input: { baseURL?: string; apiKey?: string; headers?: Record<string, string>; provider: string }, id: string) {
  if (hosted === "anthropic") {
    const { configure } = await import("@opencode-ai/llm/providers/anthropic")
    return configure({ baseURL: input.baseURL, apiKey: input.apiKey, headers: input.headers }).model(id)
  }
  if (hosted === "openai") {
    const { configure } = await import("@opencode-ai/llm/providers/openai")
    return configure({ apiKey: input.apiKey, headers: input.headers }).model(id)
  }
  const { configure } = await import("@opencode-ai/llm/providers/openai-compatible")
  // Local servers rarely need a key; without one send no Authorization header instead of failing on a missing credential.
  const auth = input.apiKey ? { apiKey: input.apiKey } : { auth: Auth.none }
  return configure({ baseURL: input.baseURL ?? "", headers: input.headers, provider: input.provider, ...auth }).model(id)
}

/** Optional params are sent only when the capability record says the server accepts them (openai-compatible only). */
// reasoning_effort: opt-in per model (provider.<id>.models.<model>.options.reasoning_effort); by ref, so handle copies keep it.
function effort(cfg: ResolvedConfig, ref: string) {
  const model = cfg.provider[ref.slice(0, Math.max(0, ref.indexOf("/")))]?.models?.[ref.slice(ref.indexOf("/") + 1)]
  const value = (model as { options?: { reasoning_effort?: unknown } } | undefined)?.options?.reasoning_effort
  return typeof value === "string" ? value : undefined
}

function build(handle: ModelHandle, req: TurnRequest, reasoningEffort: string | undefined) {
  const caps = handle.capabilities
  const compatible = handle.model.route.id === COMPATIBLE
  const thinking = req.thinking
  const body: Record<string, unknown> = compatible ? {
    ...(caps.accepts.chat_template_kwargs && thinking !== undefined ? { chat_template_kwargs: { enable_thinking: thinking } } : {}),
    ...(caps.accepts.prompt_cache_key ? { prompt_cache_key: req.session_id } : {}),
    ...(caps.accepts.reasoning_effort && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    ...(caps.accepts.parallel_tool_calls && req.tools.length > 0 ? { parallel_tool_calls: false } : {}),
  } : {}
  // `/no_think` is model-specific (Qwen templates): only when pinned, and only when enable_thinking can't be sent.
  const suffix = compatible && caps.no_think_suffix && thinking === false && !caps.accepts.chat_template_kwargs
  return LLM.request({
    model: handle.model,
    system: req.system === "" ? undefined : req.system,
    messages: suffix ? noThink(req.messages) : [...req.messages],
    tools: [...req.tools],
    generation: { maxTokens: req.maxTokens ?? handle.maxTokens },
    http: Object.keys(body).length ? { body } : undefined,
  })
}

function noThink(messages: readonly Message[]) {
  const last = messages.findLastIndex((message) => message.role === "user")
  return messages.map((message, index) =>
    index === last ? new Message({ ...message, content: [...message.content, Message.text("\n/no_think")] }) : message,
  )
}

/** Optional params a 400 names (strip them all, retry once: never a blind retry loop). */
function rejectedParams(error: LLMError, request: LLMRequest) {
  if (error.reason._tag !== "InvalidRequest") return []
  const text = error.reason.http?.body ?? error.reason.message
  return OPTIONAL.filter((param) => request.http?.body?.[param] !== undefined && text.includes(param))
}

function queueFor(baseURL: string, size: number) {
  const queue = queues.get(baseURL) ?? { semaphore: Semaphore.makeUnsafe(size), size, holders: [] as string[] }
  queues.set(baseURL, queue)
  return queue
}

/** Holds one permit for the enclosing scope; reports the first holder's label when it has to wait. */
function permit(queue: Queue, label: string, onQueued: (behind: string) => Effect.Effect<void>) {
  return Effect.gen(function* () {
    if (queue.holders.length >= queue.size) yield* onQueued(queue.holders[0] ?? "another request")
    yield* Effect.acquireRelease(
      queue.semaphore.take(1).pipe(Effect.tap(() => Effect.sync(() => queue.holders.push(label)))),
      () => Effect.sync(() => queue.holders.splice(queue.holders.indexOf(label), 1)).pipe(Effect.andThen(queue.semaphore.release(1))),
      { interruptible: true },
    )
  })
}

// vLLM streams `delta.reasoning`; @opencode-ai/llm decodes only `reasoning_content` (ADR). Rename inside SSE lines.
function renameReasoning(base: typeof fetch): typeof fetch {
  return Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await base(input, init)
    if (!res.body || !res.headers.get("content-type")?.includes("event-stream")) return res
    const state = { rest: "" }
    const lines = new TransformStream<string, string>({
      transform: (chunk, controller) => {
        const parts = (state.rest + chunk).split("\n")
        state.rest = parts.pop() ?? ""
        parts.forEach((line) => controller.enqueue(renameLine(line) + "\n"))
      },
      flush: (controller) => controller.enqueue(renameLine(state.rest)),
    })
    const body = res.body.pipeThrough(new TextDecoderStream()).pipeThrough(lines).pipeThrough(new TextEncoderStream())
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
  }, { preconnect: base.preconnect })
}

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

function renameLine(line: string) {
  if (!line.startsWith("data:") || !line.includes('"reasoning"')) return line
  return Option.match(decodeJson(line.slice(5).trim()), {
    onNone: () => line,
    onSome: (value) => {
      const chunk = value as { choices?: Array<{ delta?: Record<string, unknown> }> }
      const choices = (chunk.choices ?? []).map((choice) => {
        if (!choice.delta || choice.delta.reasoning === undefined || choice.delta.reasoning_content !== undefined) return choice
        const { reasoning, ...delta } = choice.delta
        return { ...choice, delta: { ...delta, reasoning_content: reasoning } }
      })
      return `data: ${JSON.stringify({ ...chunk, choices })}`
    },
  })
}

/** Same layout the servers tokenize: system text, tools JSON, then every other message as JSON. */
function render(body: unknown) {
  const value = body as { messages?: Array<{ role: string; content?: unknown }>; tools?: unknown[] }
  const messages = value.messages ?? []
  return [
    ...messages.filter((item) => item.role === "system").map((item) => (typeof item.content === "string" ? item.content : JSON.stringify(item.content))),
    JSON.stringify(value.tools ?? []),
    ...messages.filter((item) => item.role !== "system").map((item) => JSON.stringify(item)),
  ].join("\n")
}

async function tokenize(baseURL: string, content: string) {
  const init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }), signal: AbortSignal.timeout(5_000) }
  const body: { tokens?: unknown[] } = await (await fetch(`${new URL(baseURL).origin}/tokenize`, init)).json()
  if (!Array.isArray(body.tokens)) throw new Error("no tokens")
  return body.tokens.length
}

/** LLM Usage → contract TokenUsage; `estimated` when the gateway had to estimate (usage_in_stream=false) or none came. */
export function tokenUsage(usage: Usage | undefined): TokenUsage {
  return {
    input: usage?.inputTokens ?? 0,
    output: usage?.outputTokens ?? 0,
    reasoning: usage?.reasoningTokens,
    cache_read: usage?.cacheReadInputTokens,
    estimated: usage === undefined || usage.providerMetadata?.oclite?.estimated === true,
  }
}

/** One-line notices for the fallbacks this handle engages; print each when `gateway.notice(key)` returns true. */
export function fallbackNotices(handle: ModelHandle) {
  const caps = handle.capabilities
  const compatible = handle.model.route.id === COMPATIBLE
  const notes = "notes" in caps && Array.isArray(caps.notes) ? (caps.notes as string[]) : []
  const items: Array<[string, string] | false> = [
    !caps.tools_native && ["tools_native", "tool calls: text protocol (server has no tool-call parser)"],
    caps.reasoning_field === "reasoning" && ["reasoning_field", "reasoning: reading vLLM delta.reasoning as reasoning_content"],
    caps.reasoning_field === "none" && caps.think_tags && ["think_tags", "reasoning: splitting <think> tags out of the text"],
    !caps.usage_in_stream && ["usage_in_stream", `token counts: estimated (${caps.tokenize ? "/tokenize" : "chars/4"}), marked est.`],
    handle.local && !caps.prefix_cache && ["prefix_cache", "prefix cache: none detected; auto profile is local-min"],
    ...OPTIONAL.map((param): [string, string] | false => compatible && !caps.accepts[param] && [`accepts.${param}`, `request: ${param} not accepted by the server, not sent`]),
    ...notes.map((note): [string, string] => [note, note]),
  ]
  return items.filter((item) => item !== false).map((item) => ({ key: `${redactUrl(handle.baseURL)} ${item[0]}`, message: item[1] }))
}
