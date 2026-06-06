import type { Model } from "@opencode-ai/sdk/v2"

export const PROVIDER_ID = "google-antigravity"
export const CLOUDCODE_BASE = "https://cloudcode-pa.googleapis.com"
// Placeholder base handed to @ai-sdk/google; the auth fetch rewrites every request
// to CLOUDCODE_BASE/v1internal, so only the URL *shape* (.../models/<id>:<method>)
// matters here.
export const AISDK_BASE = "https://generativelanguage.googleapis.com/v1beta"

// The Code Assist backend gates its richer endpoints (notably fetchAvailableModels)
// on this exact User-Agent — without it they return 403. agy sends it on every call.
export const AGY_USER_AGENT = "antigravity"

export function agyHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": AGY_USER_AGENT,
  }
}

// Static fallback only — the live catalog comes from fetchAvailableModels (see below).
// This small set is used if that call fails (offline / transient error) so the picker
// isn't empty. ids/names mirror fetchAvailableModels and are verified against
// v1internal:generateContent across all three upstream providers.
interface Spec {
  id: string
  name: string
  context: number
  output: number
  reasoning?: boolean
  image?: boolean
  status?: Model["status"]
  family?: string
}

const SPECS: Spec[] = [
  { id: "gemini-3-flash", name: "Gemini 3 Flash", context: 1_048_576, output: 65_536, reasoning: true, image: true },
  { id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)", context: 1_048_576, output: 65_536, reasoning: true, image: true },
  { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)", context: 1_048_576, output: 65_536, reasoning: true, image: true },
  { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", context: 1_048_576, output: 65_536, reasoning: true, image: true },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", context: 250_000, output: 64_000, reasoning: true, image: true, family: "claude" },
  { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", context: 131_072, output: 32_768, reasoning: true, family: "gpt-oss" },
]

function buildModel(spec: Spec): Model {
  return {
    id: spec.id,
    providerID: PROVIDER_ID,
    api: { id: spec.id, url: AISDK_BASE, npm: "@ai-sdk/google" },
    name: spec.name,
    family: spec.family ?? "gemini",
    capabilities: {
      temperature: true,
      reasoning: spec.reasoning ?? false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: spec.image ?? false, video: false, pdf: spec.image ?? false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    // Access is via the user's Antigravity subscription, not metered per token.
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: spec.context, output: spec.output },
    status: spec.status ?? "active",
    options: {},
    headers: {},
    release_date: "2026-01-01",
  }
}

// Static fallback catalog (used if the live fetchAvailableModels call fails).
export function catalog(): Record<string, Model> {
  return Object.fromEntries(SPECS.map((s) => [s.id, buildModel(s)]))
}

// ---- dynamic model discovery ----------------------------------------------
//
// agy's `fetchAvailableModels` is the authoritative catalog: it carries the real
// display names, context/output limits, image + thinking support, and crucially
// the non-derivable id->name mapping (e.g. id `gemini-3-flash-agent` is shown as
// "Gemini 3.5 Flash (High)"). It's gated on the `antigravity` User-Agent — without
// it the endpoint 403s, which is why naive callers fall back to the thinner
// retrieveUserQuota list (gemini-only, wrong names). With the right UA we get the
// full set: Gemini + Claude + GPT-OSS, all reachable through generateContent.
interface FamModel {
  displayName?: string
  supportsImages?: boolean
  supportsThinking?: boolean
  maxTokens?: number
  maxOutputTokens?: number
  recommended?: boolean
  modelProvider?: string
}

// Internal/utility models agy never surfaces (tab-completion, checkpointers), plus
// ids verified to 400 on generateContent even though they're listed (the broken
// `-high` pro variant; its twin `gemini-pro-agent` renders the same name and works).
const SKIP_ID = /^(tab_|chat_)/
const BROKEN_IDS = new Set(["gemini-3.1-pro-high"])

function familyOf(modelProvider: string | undefined): string {
  if (modelProvider === "MODEL_PROVIDER_ANTHROPIC") return "claude"
  if (modelProvider === "MODEL_PROVIDER_OPENAI") return "gpt-oss"
  return "gemini"
}

// @ai-sdk/google is the transport for every model (Claude/GPT-OSS included): the
// Code Assist envelope is Gemini-shaped and the backend translates, so responses
// come back as standard GenerateContentResponses regardless of upstream provider.
function buildFamModel(id: string, m: FamModel): Model {
  return buildModel({
    id,
    name: m.displayName ?? id,
    family: familyOf(m.modelProvider),
    context: m.maxTokens ?? 1_048_576,
    output: m.maxOutputTokens ?? 65_536,
    reasoning: m.supportsThinking ?? false,
    image: m.supportsImages ?? false,
    status: "active",
  })
}

// Fetch agy's full catalog. Dedupes by display name (several internal ids share a
// name, e.g. four ids all show "Gemini 3.1 Flash Lite") preferring the recommended
// one so the picker reads like agy's own.
export async function fetchAvailableModels(accessToken: string, project: string): Promise<Record<string, Model>> {
  const res = await fetch(`${CLOUDCODE_BASE}/v1internal:fetchAvailableModels`, {
    method: "POST",
    headers: agyHeaders(accessToken),
    body: JSON.stringify({ project }),
  })
  if (!res.ok) throw new Error(`fetchAvailableModels failed: ${res.status}`)
  const json = (await res.json()) as { models?: Record<string, FamModel> }
  const entries = Object.entries(json.models ?? {}).filter(
    ([id, m]) => m.displayName && !SKIP_ID.test(id) && !BROKEN_IDS.has(id),
  )

  // Keep one id per display name, preferring recommended.
  const byName = new Map<string, { id: string; m: FamModel }>()
  for (const [id, m] of entries) {
    const name = m.displayName!
    const existing = byName.get(name)
    if (!existing || (m.recommended && !existing.m.recommended)) byName.set(name, { id, m })
  }

  const out: Record<string, Model> = {}
  for (const { id, m } of byName.values()) out[id] = buildFamModel(id, m)
  return out
}

// Build the catalog live from agy's catalog, falling back to the static list.
export async function dynamicCatalog(accessToken: string, project: string): Promise<Record<string, Model>> {
  const models = await fetchAvailableModels(accessToken, project)
  if (Object.keys(models).length === 0) return catalog()
  return models
}

// ---- Code Assist handshake -------------------------------------------------

// loadCodeAssist returns the (Google-managed) project the account is provisioned
// against; v1internal:generateContent requires it in the request envelope.
export async function loadProject(accessToken: string): Promise<string> {
  const res = await fetch(`${CLOUDCODE_BASE}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers: agyHeaders(accessToken),
    body: JSON.stringify({
      metadata: { ideType: "IDE_UNSPECIFIED", platform: "PLATFORM_UNSPECIFIED", pluginType: "GEMINI" },
    }),
  })
  if (!res.ok) throw new Error(`loadCodeAssist failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { cloudaicompanionProject?: string }
  if (!json.cloudaicompanionProject) throw new Error("loadCodeAssist returned no project")
  return json.cloudaicompanionProject
}

// ---- request/response envelope translation ---------------------------------

const URL_RE = /\/models\/([^:/]+):(streamGenerateContent|generateContent)/

interface GeminiPart {
  functionCall?: { name?: string; id?: string; args?: unknown }
  functionResponse?: { name?: string; id?: string; response?: unknown }
}
interface GeminiContent {
  parts?: GeminiPart[]
}

// @ai-sdk/google drops the tool-call id from functionCall/functionResponse parts for
// regular function tools (it only sets it for server tools). Gemini tolerates that —
// it pairs calls to responses positionally — but the Code Assist backend translates
// these to Anthropic tool_use / OpenAI tool_calls, which *require* a matching id, so
// Claude and GPT-OSS reject the request ("tool_use.id: Field required"). Synthesize
// stable ids and pair them via a FIFO queue per tool name, mirroring the order Gemini
// emits parallel calls and their responses. Harmless for Gemini (id is a valid field).
function injectToolCallIds(request: { contents?: GeminiContent[] }): void {
  const pending = new Map<string, string[]>() // tool name -> queued call ids awaiting a response
  let seq = 0
  for (const content of request.contents ?? []) {
    for (const part of content.parts ?? []) {
      const call = part.functionCall
      if (call) {
        // Synthesize an id only when missing; queue it (native or synthesized) so the
        // matching response below can pick up the same id regardless.
        if (!call.id) call.id = `call_${seq++}`
        const name = call.name ?? ""
        const queue = pending.get(name) ?? (pending.set(name, []), pending.get(name)!)
        queue.push(call.id)
      }
      const resp = part.functionResponse
      if (resp && !resp.id) {
        resp.id = pending.get(resp.name ?? "")?.shift() ?? `call_${seq++}`
      }
    }
  }
}

// Rewrite an @ai-sdk/google request into the cloudcode-pa v1internal envelope.
// Returns the new URL + body, or null if the request isn't a generate call.
export function translateRequest(
  url: string,
  bodyText: string | undefined,
  project: string,
): { url: string; body: string; streaming: boolean } | null {
  const m = URL_RE.exec(url)
  if (!m) return null
  const [, model, method] = m
  const streaming = method === "streamGenerateContent"
  const inner = bodyText ? JSON.parse(bodyText) : {}
  injectToolCallIds(inner)
  const target = `${CLOUDCODE_BASE}/v1internal:${method}${streaming ? "?alt=sse" : ""}`
  return { url: target, body: JSON.stringify({ model, project, request: inner }), streaming }
}

// cloudcode wraps every GenerateContentResponse as { response: <resp> }. The AI SDK
// expects the bare resp, so unwrap it (non-streaming).
export async function unwrapJson(res: Response): Promise<Response> {
  const json = (await res.json()) as { response?: unknown }
  const unwrapped = json && typeof json === "object" && "response" in json ? json.response : json
  return new Response(JSON.stringify(unwrapped), {
    status: res.status,
    statusText: res.statusText,
    headers: { "content-type": "application/json" },
  })
}

// Streaming: cloudcode emits SSE `data: {"response": {...}}` lines; unwrap each
// `.response` so the AI SDK's Gemini stream parser sees bare GenerateContentResponses.
export function unwrapSse(res: Response): Response {
  if (!res.body) return res
  const dec = new TextDecoder()
  const enc = new TextEncoder()
  let buf = ""
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buf += dec.decode(chunk, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.startsWith("data:")) {
          controller.enqueue(enc.encode(line + "\n"))
          continue
        }
        const payload = line.slice(5).trim()
        if (!payload || payload === "[DONE]") {
          controller.enqueue(enc.encode(line + "\n"))
          continue
        }
        try {
          const obj = JSON.parse(payload) as { response?: unknown }
          const inner = obj && typeof obj === "object" && "response" in obj ? obj.response : obj
          controller.enqueue(enc.encode(`data: ${JSON.stringify(inner)}\n`))
        } catch {
          controller.enqueue(enc.encode(line + "\n"))
        }
      }
    },
    flush(controller) {
      if (buf) controller.enqueue(enc.encode(buf))
    },
  })
  return new Response(res.body.pipeThrough(transform), {
    status: res.status,
    statusText: res.statusText,
    headers: { "content-type": "text/event-stream" },
  })
}

// Antigravity enforces a tight per-minute request throttle (the same one `agy` itself
// hits). opencode can fire two near-simultaneous requests at the start of a session —
// the main turn plus a title-generation request that getSmallModel routes back here —
// which trips the throttle and makes the AI SDK dogpile retries. Serialize the *start*
// of generate calls through one chain (fetch resolves on headers, so streaming bodies
// still overlap) and back off once on a 429 so we stop amplifying the limit.
let gate: Promise<unknown> = Promise.resolve()

function parseRetryMs(res: Response, body: string): number {
  const header = res.headers.get("retry-after")
  if (header) {
    const secs = Number(header)
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000)
  }
  // Cloudcode returns the throttle window in the error text ("...reset after 49s").
  const m = /reset[a-z]*(?:\s+(?:after|in))?\s*(\d+)\s*s/i.exec(body)
  if (m) return Math.min(Number(m[1]) * 1000 + 500, 60_000)
  return 5_000
}

export async function gatedFetch(url: string, init: RequestInit): Promise<Response> {
  const run = async (): Promise<Response> => {
    const res = await fetch(url, init)
    if (res.status !== 429) return res
    const body = await res.clone().text().catch(() => "")
    await new Promise((r) => setTimeout(r, parseRetryMs(res, body)))
    return fetch(url, init)
  }
  const result = gate.then(run, run)
  gate = result.catch(() => {})
  return result
}

export * as AntigravityModels from "./models"
