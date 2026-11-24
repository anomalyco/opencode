import { Model, Provider } from "@opencode/plugin"

/** Provider and integration id used across OpenCode. */
export const PROVIDER_ID = "hostman"
/** Native OpenCode provider package speaking the OpenAI-compatible protocol. */
export const PACKAGE = "@opencode/ai/providers/openai-compatible"
export const DEFAULT_BASE_URL = "https://ai-api.hostman.com/v1"
export const DEFAULT_ENV_VAR = "HOSTMAN_API_KEY"
export const DEFAULT_REFRESH_INTERVAL_MS = 10 * 60 * 1000
export const MIN_REFRESH_INTERVAL_MS = 60 * 1000

export interface ResolvedOptions {
  readonly baseURL: string
  readonly envVar: string
  readonly refreshIntervalMs: number
}

/**
 * Model ids the gateway lists for non-chat workloads (embeddings, speech, image and video
 * generation). Entries without an explicit `mode` field are judged against this pattern and
 * hidden from the chat model list; re-enable one explicitly through the
 * `providers.hostman.models` configuration overlay if needed.
 */
export const NON_CHAT_PATTERN =
  /(embed|whisper|transcribe|tts|speech|audio|music|dall-e|sora|flux|nano-banana|image|video|wan|seedance|seedream|veo|kling|hailuo|runway)/i

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringOr(...values: unknown[]): string | undefined {
  const found = values.find((value) => typeof value === "string" && value.trim() !== "")
  return typeof found === "string" ? found : undefined
}

function toInt(value: unknown): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function firstInt(...values: unknown[]): number | undefined {
  const found = values.map(toInt).find((value) => value !== undefined)
  return found
}

/** Normalizes and validates the gateway base URL, stripping a trailing slash. */
export function normalizeBaseURL(value: string): string {
  const url = value.trim().replace(/\/+$/, "")
  if (!/^https?:\/\//.test(url)) throw new Error(`Invalid baseURL "${value}", expected an http(s) URL`)
  return url
}

/**
 * Resolves plugin options from the `options` object of the configured plugin entry, with
 * environment fallbacks. Nested `hostman` objects are merged with flat keys taking precedence.
 */
export function resolveOptions(
  options: Readonly<Record<string, unknown>> | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ResolvedOptions {
  const hostman = isRecord(options?.hostman) ? (options!.hostman as Record<string, unknown>) : {}
  const source: Record<string, unknown> = { ...hostman, ...(options ?? {}) }
  const baseURL = stringOr(source.baseURL, env.HOSTMAN_BASE_URL) ?? DEFAULT_BASE_URL
  const envVar = stringOr(source.envVar, env.HOSTMAN_ENV_VAR) ?? DEFAULT_ENV_VAR
  const refreshIntervalMs = Math.max(
    MIN_REFRESH_INTERVAL_MS,
    toInt(source.refreshIntervalMs) ?? DEFAULT_REFRESH_INTERVAL_MS,
  )
  return { baseURL: normalizeBaseURL(baseURL), envVar, refreshIntervalMs }
}

/**
 * Maps a gateway `GET /models` response to the OpenCode model catalog. Accepts the OpenAI
 * shape `{ data: [...] }` as well as a bare array; entries without a usable `id` and
 * non-chat workloads are skipped.
 */
export function parseModels(body: unknown): Model.Info[] {
  const items = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.data) ? body.data : []
  const valid = items.filter(
    (item): item is Record<string, unknown> & { id: string } =>
      isRecord(item) && typeof item.id === "string" && item.id.trim() !== "" && isChatModel(item, item.id),
  )
  const unique = new Map(valid.map((item) => [item.id, item] as const))
  return Array.from(unique.values())
    .map((item) => toModel(item.id, item))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

/**
 * The gateway tags entries with a workload `mode` (`chat`, `embedding`, ...); only `chat`
 * is usable in the OpenCode model list. Entries without a `mode` field fall back to the
 * non-chat id pattern.
 */
function isChatModel(item: Record<string, unknown>, id: string): boolean {
  const mode = typeof item.mode === "string" ? item.mode.toLowerCase() : undefined
  if (mode !== undefined) return mode === "chat"
  return !NON_CHAT_PATTERN.test(id)
}

/**
 * Builds one catalog entry for a gateway model id such as `openai/gpt-5-mini`. The full
 * gateway id is kept as the `modelID`, so requests are sent back to the gateway verbatim.
 * Context and output limits are taken from the response when the gateway reports them
 * (`max_input_tokens` / `max_output_tokens` on the Hostman gateway).
 */
export function toModel(id: string, raw: Record<string, unknown> = {}): Model.Info {
  const context = firstInt(raw.max_input_tokens, raw.context_length, raw.context_window, raw.max_context, raw.context)
  const output = firstInt(raw.max_output_tokens, raw.max_output, raw.output_tokens)
  return {
    id: Model.ID.make(id),
    modelID: Model.ID.make(id),
    providerID: Provider.ID.make(PROVIDER_ID),
    type: "chat",
    name: stringOr(raw.name, raw.title, raw.display_name) ?? id,
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: context ?? 200_000, output: output ?? 32_000 },
  }
}
