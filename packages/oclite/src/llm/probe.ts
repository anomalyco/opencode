// Capability probe + cache (ARCHITECTURE §10). At most 3 requests (R1 GET /models, R2 + R3 streamed chat); config pins
// are applied first and pinned fields are never probed. Hosted anthropic/openai use STATIC and are never probed.
import path from "path"
import { Effect, Option, Schema } from "effect"
import { type Capabilities, type CapSource, ConfigError, type ServerPins } from "../contract"
import { dataDir, isLoopback } from "../util/paths"
import { redactText, redactUrl, urlSecrets } from "../util/redact"

export type CapabilityRecord = Capabilities & {
  v: 1; base_url: string; model: string; probed_at: number; ttl_ms: number
  sources: Record<keyof Capabilities, CapSource>; ttft_ms?: [number, number]; notes: string[]
}
export type CapabilityPatch = Partial<Omit<Capabilities, "accepts">> & { accepts?: Partial<Capabilities["accepts"]> }
export type ProbeInput = {
  baseURL: string; model: string; apiKey?: string; headers?: Record<string, string>; pins?: ServerPins; reprobe: boolean
  timeouts?: Partial<typeof TIMEOUTS>                      // ms; tests shorten them
}
type Context = ProbeInput & { limits: typeof TIMEOUTS; deadline: number; shown: string; hint: string }

const TTL_MS = 604_800_000
// A server that accepts the connection but never answers must not hang startup (per request + whole probe).
const TIMEOUTS = { models: 5_000, chat: 30_000, total: 60_000 }
export const OPTIONAL = ["chat_template_kwargs", "prompt_cache_key", "reasoning_effort", "parallel_tool_calls"] as const
const CHAT_FIELDS = ["usage_in_stream", "reasoning_field", "think_tags", "tools_native", "prefix_cache"] as const
// Deterministic ~2k-token system prefix so the second request can hit a prefix cache (TTFT heuristic, ADR).
const PAD = Array.from({ length: 160 }, (_, i) => `Reference line ${i}: the quick brown fox jumps over the lazy dog.`).join("\n")

export const STATIC: Capabilities = { context_window: 200_000, usage_in_stream: true, reasoning_field: "reasoning_content", think_tags: false,
  tools_native: true, accepts: { chat_template_kwargs: true, prompt_cache_key: true, reasoning_effort: true, parallel_tool_calls: true },
  prefix_cache: true, concurrency: 8, tokenize: false, no_think_suffix: false }

export function probe(input: ProbeInput) {
  return Effect.tryPromise({
    try: () => run(input),
    // Every message is redacted: a baseURL may carry `user:key@` or `?api_key=`.
    catch: (error) => new ConfigError({ message: redactText(error instanceof ConfigError ? error.message : `${redactUrl(input.baseURL)}: ${String(error)}`, urlSecrets(input.baseURL)) }),
  })
}

/** The record for a hosted provider: STATIC values (context from the models config), pins still win. */
export function staticRecord(baseURL: string, model: string, pins?: ServerPins): CapabilityRecord {
  const sources = Object.fromEntries(Object.keys(STATIC).map((key) => [key, "static"])) as CapabilityRecord["sources"]
  return applyPins({ ...STATIC, v: 1, base_url: redactUrl(baseURL), model, probed_at: Date.now(), ttl_ms: TTL_MS, sources, notes: [] }, pins)
}

/** Merge a runtime finding (400 naming a param or the context limit) into the cached record. */
export function persist(baseURL: string, model: string, patch: CapabilityPatch, source: CapSource) {
  return Effect.promise(async () => {
    const file = cacheFile(baseURL, model)
    const record = await readRecord(file)
    if (!record) return
    const keys = Object.keys(patch) as Array<keyof Capabilities>
    await Bun.write(file, JSON.stringify({ ...record, ...patch, accepts: { ...record.accepts, ...patch.accepts },
      sources: { ...record.sources, ...Object.fromEntries(keys.map((key) => [key, source])) } }, null, 2))
  })
}

export function cacheFile(baseURL: string, model: string) {
  return path.join(dataDir(), "servers", `${hostPort(baseURL).replace(":", "_")}-${model.replace(/[^A-Za-z0-9._-]/g, "_")}.json`)
}

const hostPort = (baseURL: string) => {
  const url = new URL(baseURL)
  return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`
}

async function run(probeInput: ProbeInput) {
  // `servers.<url>.probe_timeout_ms` raises the per-chat limit (slow-CPU llama.cpp); not in ServerPins, read structurally.
  const pinned = (probeInput.pins as { probe_timeout_ms?: unknown } | undefined)?.probe_timeout_ms
  const chat = typeof pinned === "number" ? pinned : (probeInput.timeouts?.chat ?? TIMEOUTS.chat)
  const limits = { ...TIMEOUTS, ...probeInput.timeouts, chat }
  // Config keys are the user's raw base URL (maybe with credentials): name it generically, show only host:port.
  const hint = hostPort(probeInput.baseURL)
  const input: Context = { ...probeInput, limits, deadline: Date.now() + Math.max(limits.total, limits.models + 2 * chat),
    shown: redactUrl(probeInput.baseURL), hint }
  const file = cacheFile(input.baseURL, input.model)
  const cached = input.reprobe ? undefined : await readRecord(file)
  if (cached && cached.probed_at + cached.ttl_ms > Date.now()) {
    await listModels(input) // reachability: an unreachable server still exits 2 on a cache hit
    return applyPins(cached, input.pins)
  }
  const record = await measure(input)
  await Bun.write(file, JSON.stringify(record, null, 2))
  return record
}

async function measure(input: Context): Promise<CapabilityRecord> {
  const pins = flatten(input.pins)
  const notes: string[] = []
  const pin = (key: string) => `pin servers[<your base URL>].${key} for ${input.hint}`
  const models = pins.context_window === undefined || pins.tokenize === undefined ? await listModels(input) : undefined
  const context = pins.context_window ?? models?.context
  if (context === undefined) notes.push(`context window: unknown, using 32768 (${pin("context_window")})`)
  const chatNeeded = CHAT_FIELDS.some((key) => pins[key] === undefined) || OPTIONAL.some((key) => pins.accepts?.[key] === undefined)
  const offered = OPTIONAL.filter((key) => pins.accepts?.[key] !== false)
  // Fully pinned (no request below): still check the server answers at all, so an unreachable one exits 2 here.
  if (!models && !chatNeeded) await listModels(input)
  const r2 = chatNeeded ? await chat(input, offered, true, pins.tools_native !== false) : undefined
  // Params a 400 body names; a 400 that names none rejects every optional param that was offered.
  const named = r2?.status === 400 ? offered.filter((key) => r2.body.includes(key)) : []
  const rejected = r2?.status === 400 ? (named.length ? named : offered) : []
  const accepted = offered.filter((key) => !rejected.includes(key))
  const cutInReasoning = r2?.finish === "length" && r2.reasoning !== "none" && !r2.tools
  const r3 = r2 && r2.status !== TIMED_OUT && (r2.status !== 200 || pins.prefix_cache === undefined || cutInReasoning)
    ? await chat(input, accepted, false, pins.tools_native !== false) : undefined
  const seen = r2?.status === 200 ? r2 : r3?.status === 200 ? r3 : undefined
  const timed = r2?.status === 200 && r3?.status === 200 ? ([r2.ttft, r3.ttft] as [number, number]) : undefined
  const slow = r2?.status === TIMED_OUT || r3?.status === TIMED_OUT
  if (slow) notes.push(`probe timed out after ${input.limits.chat / 1000} s; ${pin("capabilities")} to skip, or raise probe_timeout_ms`)
  if (r2 && !timed && !slow && pins.prefix_cache === undefined) notes.push(`prefix cache: not measurable, assuming none (${pin("capabilities.prefix_cache")})`)
  const toolsNoted = r2?.status === 400 && /\btools?\b/i.test(OPTIONAL.reduce((body, key) => body.replaceAll(key, ""), r2.body))
  // Timed-out R2 (R3 skipped): conservative defaults — native tools, standard fields, no optional params.
  const unseen = !seen && r2?.status === TIMED_OUT
  const observed: Capabilities = {
    context_window: context ?? 32768,
    usage_in_stream: seen?.usage ?? unseen,
    reasoning_field: seen?.reasoning ?? (unseen ? "reasoning_content" : "none"),
    think_tags: seen?.think ?? false,
    tools_native: !toolsNoted && ((cutInReasoning ? r3?.tools : seen?.tools) ?? unseen),
    accepts: Object.fromEntries(OPTIONAL.map((key) => [key, !unseen && accepted.includes(key)])) as Capabilities["accepts"],
    prefix_cache: timed ? timed[1] <= 0.7 * timed[0] : false,
    concurrency: isLoopback(input.baseURL) ? 1 : 8,
    tokenize: models?.tokenize ?? false,
    no_think_suffix: false,
  }
  const sources = Object.fromEntries(Object.keys(observed).map((key) => [key, "probe"])) as CapabilityRecord["sources"]
  const defaulted = [...(context === undefined ? ["context_window"] : []), ...(timed ? [] : ["prefix_cache"]), ...(models ? [] : ["tokenize"]),
    ...(seen ? [] : ["usage_in_stream", "reasoning_field", "think_tags", "tools_native"]), ...(unseen ? ["accepts"] : []), "concurrency", "no_think_suffix"]
  const record: CapabilityRecord = {
    ...observed, v: 1, base_url: input.shown, model: input.model, probed_at: Date.now(), ttl_ms: TTL_MS,
    sources: { ...sources, ...Object.fromEntries(defaulted.map((key) => [key, "default"])) }, ttft_ms: timed, notes,
  }
  return applyPins(record, input.pins)
}

function applyPins(record: CapabilityRecord, pins?: ServerPins): CapabilityRecord {
  const flat = flatten(pins)
  const keys = Object.keys(flat).filter((key) => key !== "accepts" || OPTIONAL.every((p) => flat.accepts?.[p] !== undefined))
  return { ...record, ...flat, accepts: { ...record.accepts, ...flat.accepts },
    sources: { ...record.sources, ...Object.fromEntries(keys.map((key) => [key, "config"])) } }
}

function flatten(pins?: ServerPins): CapabilityPatch {
  const merged = { ...pins?.capabilities, context_window: pins?.context_window ?? pins?.capabilities?.context_window,
    concurrency: pins?.concurrency ?? pins?.capabilities?.concurrency }
  const accepts = Object.fromEntries(Object.entries(merged.accepts ?? {}).filter((entry) => entry[1] !== undefined))
  return Object.fromEntries(Object.entries({ ...merged, accepts: Object.keys(accepts).length ? accepts : undefined })
    .filter((entry) => entry[1] !== undefined))
}

/** A missing or unreadable cache file reads as "no record". */
function readRecord(file: string): Promise<CapabilityRecord | undefined> {
  return Bun.file(file).json().then((value: CapabilityRecord) => (value?.v === 1 ? value : undefined), () => undefined)
}

async function send(input: Context, url: string, timeout: number, init?: RequestInit, soft = false) {
  const ms = Math.max(1, Math.min(timeout, input.deadline - Date.now()))
  const headers = { "content-type": "application/json", ...input.headers, ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {}) }
  return fetch(url, { ...init, headers, signal: AbortSignal.timeout(ms) }).catch((error: unknown) => {
    if (soft && isTimeout(error)) throw error
    const detail = isTimeout(error) ? `no response within ${ms / 1000} s` : String(error)
    throw new ConfigError({ message: `cannot reach ${input.shown}: ${detail}` })
  })
}

async function listModels(input: Context) {
  const res = await send(input, `${input.baseURL.replace(/\/+$/, "")}/models`, input.limits.models)
  if (!res.ok) return undefined
  const body: { data?: Array<Record<string, unknown>> } = await res.json().catch(() => ({}))
  const item = body.data?.find((entry) => entry.id === input.model) ?? body.data?.[0]
  if (!item) return undefined
  const meta = (item.meta ?? {}) as Record<string, unknown>
  const context = [item.max_model_len, item.context_length, meta.n_ctx, meta.n_ctx_train].find((value) => typeof value === "number")
  return { context: context as number | undefined, tokenize: item.owned_by === "llamacpp" }
}

const TIMED_OUT = -1
const isTimeout = (error: unknown) => error instanceof Error && error.name === "TimeoutError"
/** Only /models is fatal; a chat timeout (headers or body) becomes status TIMED_OUT and conservative defaults. */
function chat(input: Context, params: readonly string[], thinking: boolean, tools: boolean) {
  return chatOnce(input, params, thinking, tools).catch((error: unknown) => {
    if (!isTimeout(error)) throw error
    return { status: TIMED_OUT, body: "", ttft: 0, tools: false, usage: false, think: false, reasoning: "none" as const, finish: undefined }
  })
}

async function chatOnce(input: Context, params: readonly string[], thinking: boolean, tools: boolean) {
  const optional: Record<string, unknown> = {
    chat_template_kwargs: { enable_thinking: thinking }, prompt_cache_key: "oclite-probe", reasoning_effort: "low", parallel_tool_calls: false,
  }
  const started = performance.now()
  const res = await send(input, `${input.baseURL.replace(/\/+$/, "")}/chat/completions`, input.limits.chat, {
    method: "POST",
    body: JSON.stringify({
      model: input.model, stream: true, stream_options: { include_usage: true }, max_tokens: 256,
      messages: [{ role: "system", content: `${PAD}\nUse tools when asked.` }, { role: "user", content: "Call the probe tool with x=1" }],
      ...(tools ? { tools: [{ type: "function", function: { name: "probe", description: "Probe tool.",
        parameters: { type: "object", properties: { x: { type: "integer" } }, required: ["x"] } } }] } : {}),
      ...Object.fromEntries(params.map((key) => [key, optional[key]])),
    }),
  }, true)
  if (!res.ok || !res.body) return { status: res.status, body: await res.text(), ttft: 0, tools: false, usage: false, think: false, reasoning: "none" as const }
  const reader = res.body.getReader()
  const first = await reader.read()
  const ttft = performance.now() - started
  const text = Buffer.concat([...(first.value ? [first.value] : []), ...(first.done ? [] : await drain(reader))]).toString()
  const events = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim())
    .flatMap((data) => Option.toArray(decodeJson(data))) as Chunk[]
  const choices = events.flatMap((event) => event.choices ?? [])
  const deltas = choices.flatMap((choice) => (choice.delta ? [choice.delta] : []))
  return {
    status: 200, body: "", ttft,
    tools: deltas.some((delta) => (delta.tool_calls?.length ?? 0) > 0),
    usage: events.some((event) => typeof event.usage?.prompt_tokens === "number"),
    think: deltas.map((delta) => delta.content ?? "").join("").includes("<think>"),
    reasoning: deltas.some((delta) => delta.reasoning_content) ? ("reasoning_content" as const)
      : deltas.some((delta) => delta.reasoning) ? ("reasoning" as const) : ("none" as const),
    finish: choices.map((choice) => choice.finish_reason).findLast((reason) => typeof reason === "string") ?? undefined,
  }
}

type Delta = { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: unknown[] | null }
type Chunk = { choices?: Array<{ delta?: Delta; finish_reason?: string | null }>; usage?: { prompt_tokens?: number } | null }
const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array[]> {
  const next = await reader.read()
  if (next.done) return []
  return [next.value, ...(await drain(reader))]
}
