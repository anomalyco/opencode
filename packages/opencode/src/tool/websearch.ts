import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./websearch.txt"
import { checksum } from "@opencode-ai/core/util/encode"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Config } from "@/config/config"
import { ConfigWebSearch } from "@/config/websearch"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000)",
  }),
})

export type Params = Schema.Schema.Type<typeof Parameters>

// A resolved websearch provider, ready to invoke. `enabled` is a property of
// the resolution set (we never put a disabled provider on the list); the
// descriptor itself only carries what is needed to make the call.
export interface ResolvedProvider {
  id: string
  label: string
  url: string
  tool: string
  weight: number
  headers: () => Record<string, string>
  buildArgs: (params: Params, ctx: Tool.Context) => unknown
}

const USER_AGENT_HEADERS = () => ({ "User-Agent": `opencode/${InstallationVersion}` })

// Built-in providers. Each entry is a function so URLs/headers/args close over
// `process.env` at *call time*, matching the previous behavior where
// `EXA_API_KEY` / `PARALLEL_API_KEY` were read lazily.
const BUILTINS: Record<string, () => ResolvedProvider> = {
  exa: () => ({
    id: "exa",
    label: "Exa Web Search",
    url: process.env.EXA_API_KEY
      ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
      : "https://mcp.exa.ai/mcp",
    tool: "web_search_exa",
    weight: 1,
    headers: USER_AGENT_HEADERS,
    buildArgs: (params) => ({
      query: params.query,
      type: params.type || "auto",
      numResults: params.numResults || 8,
      livecrawl: params.livecrawl || "fallback",
      contextMaxCharacters: params.contextMaxCharacters,
    }),
  }),
  parallel: () => ({
    id: "parallel",
    label: "Parallel Web Search",
    url: "https://search.parallel.ai/mcp",
    tool: "web_search",
    weight: 1,
    headers: () =>
      process.env.PARALLEL_API_KEY
        ? { ...USER_AGENT_HEADERS(), Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
        : USER_AGENT_HEADERS(),
    buildArgs: (params, ctx) => ({
      objective: params.query,
      search_queries: [params.query],
      session_id: ctx.sessionID,
      model_name: webSearchModelName(ctx.extra),
    }),
  }),
}

const BUILTIN_IDS = Object.keys(BUILTINS)

// Resolve a final list of enabled providers from runtime flags + user config.
// The two backcompat env flags (`OPENCODE_ENABLE_EXA` / `OPENCODE_ENABLE_PARALLEL`,
// plus the legacy `OPENCODE_EXPERIMENTAL_*` aliases — already collapsed in
// runtime-flags) seed the built-in `enabled` state; user config can flip it
// either direction and add new providers.
export function resolveProviders(
  flags: { exa: boolean; parallel: boolean },
  config: ConfigWebSearch.Info | undefined,
): ResolvedProvider[] {
  const overrides = config?.providers ?? {}
  const seen = new Set<string>()
  const out: ResolvedProvider[] = []

  for (const id of BUILTIN_IDS) {
    seen.add(id)
    const override = overrides[id]
    const envEnabled = id === "exa" ? flags.exa : id === "parallel" ? flags.parallel : false
    const enabled = override?.enabled ?? envEnabled
    if (!enabled) continue
    out.push(applyOverride(BUILTINS[id](), override))
  }

  for (const [id, override] of Object.entries(overrides)) {
    if (seen.has(id)) continue
    if (override.enabled === false) continue
    // User-defined providers must specify at least url + tool to be callable.
    if (!override.url || !override.tool) continue
    out.push(fromConfig(id, override))
  }

  return out
}

function applyOverride(base: ResolvedProvider, override: ConfigWebSearch.Provider | undefined): ResolvedProvider {
  if (!override) return base
  const merged: ResolvedProvider = { ...base }
  if (override.label !== undefined) merged.label = override.label
  if (override.url !== undefined) merged.url = override.url
  if (override.tool !== undefined) merged.tool = override.tool
  if (override.weight !== undefined) merged.weight = positiveWeight(override.weight, base.weight)
  if (override.headers) {
    const extra = override.headers
    const baseHeaders = base.headers
    merged.headers = () => ({ ...baseHeaders(), ...substituteHeaders(extra) })
  }
  if (override.args) {
    const template = override.args
    merged.buildArgs = (params, ctx) => substituteArgs(template, params, ctx)
  }
  return merged
}

function fromConfig(id: string, cfg: ConfigWebSearch.Provider): ResolvedProvider {
  const headers = cfg.headers
  const args = cfg.args
  return {
    id,
    label: cfg.label ?? defaultLabel(id),
    url: cfg.url!,
    tool: cfg.tool!,
    weight: positiveWeight(cfg.weight, 1),
    headers: () => (headers ? { ...USER_AGENT_HEADERS(), ...substituteHeaders(headers) } : USER_AGENT_HEADERS()),
    buildArgs: (params, ctx) => (args ? substituteArgs(args, params, ctx) : { query: params.query }),
  }
}

function positiveWeight(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

function defaultLabel(id: string) {
  return `${id.charAt(0).toUpperCase()}${id.slice(1)} Web Search`
}

// `{env:NAME}` is substituted upstream in config loading, but headers may also
// contain it for user-defined providers added at runtime. Apply the same rule
// here so behavior is consistent regardless of how the value arrived.
function substituteHeaders(headers: Record<string, string>) {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = substituteEnv(v)
  }
  return out
}

function substituteEnv(value: string) {
  return value.replace(/\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? "")
}

// Apply `{placeholder}` substitution to a template object. String leaves are
// substituted; arrays and nested objects recurse; non-string leaves pass through.
function substituteArgs(template: Record<string, unknown>, params: Params, ctx: Tool.Context): unknown {
  const values: Record<string, unknown> = {
    query: params.query,
    numResults: params.numResults,
    livecrawl: params.livecrawl,
    type: params.type,
    contextMaxCharacters: params.contextMaxCharacters,
    sessionID: ctx.sessionID,
  }
  return substituteValue(template, values)
}

function substituteValue(value: unknown, values: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    // Whole-string placeholder like "{numResults}" — preserve original type.
    const whole = value.match(/^\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/)
    if (whole) return values[whole[1]]
    return value.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_, name) => {
      const v = values[name]
      return v === undefined || v === null ? "" : String(v)
    })
  }
  if (Array.isArray(value)) return value.map((item) => substituteValue(item, values))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = substituteValue(v, values)
    return out
  }
  return value
}

// Pick one provider for this call. Honors the env override, then the
// configured default, otherwise routes deterministically across enabled
// providers using a checksum-weighted split (generalizes the prior 50/50).
export function selectWebSearchProvider(
  sessionID: string,
  providers: ResolvedProvider[],
  options?: { default?: string },
): ResolvedProvider | undefined {
  if (providers.length === 0) return undefined

  const override = process.env.OPENCODE_WEBSEARCH_PROVIDER
  if (override) {
    const match = providers.find((p) => p.id === override)
    if (match) return match
  }

  const defaultID = options?.default
  if (defaultID) {
    const match = providers.find((p) => p.id === defaultID)
    if (match) return match
  }

  // Stable order so the selection is reproducible across runs regardless of
  // config iteration order or provider registration timing.
  const sorted = [...providers].sort((a, b) => a.id.localeCompare(b.id))
  const total = sorted.reduce((sum, p) => sum + p.weight, 0)
  if (total <= 0) return sorted[0]

  const seed = Number.parseInt(checksum(sessionID) ?? "0", 36)
  let bucket = ((seed % total) + total) % total
  for (const provider of sorted) {
    if (bucket < provider.weight) return provider
    bucket -= provider.weight
  }
  return sorted[sorted.length - 1]
}

export function webSearchProviderLabel(provider: unknown) {
  if (typeof provider === "object" && provider !== null && "label" in provider && typeof provider.label === "string") {
    return provider.label
  }
  if (typeof provider === "string") {
    if (provider === "parallel") return "Parallel Web Search"
    if (provider === "exa") return "Exa Web Search"
    return defaultLabel(provider)
  }
  return "Web Search"
}

export function webSearchModelName(extra: Tool.Context["extra"]) {
  const model = extra?.model
  if (!model || typeof model !== "object") return undefined
  const api = "api" in model && model.api && typeof model.api === "object" ? model.api : undefined
  const apiID = api && "id" in api && typeof api.id === "string" ? api.id : undefined
  const id = "id" in model && typeof model.id === "string" ? model.id : undefined
  return (apiID ?? id)?.slice(0, 100)
}

function callProvider(http: HttpClient.HttpClient, provider: ResolvedProvider, params: Params, ctx: Tool.Context) {
  return McpWebSearch.call(http, {
    url: provider.url,
    tool: provider.tool,
    args: provider.buildArgs(params, ctx),
    headers: provider.headers(),
    timeout: "25 seconds",
  })
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service
    const config = yield* Config.Service

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const cfg = (yield* config.get()).websearch
          const providers = resolveProviders({ exa: flags.enableExa, parallel: flags.enableParallel }, cfg)
          const provider = selectWebSearchProvider(ctx.sessionID, providers, { default: cfg?.default })

          const metadata: { provider?: string } = {}

          if (!provider) {
            return {
              output: "Websearch is not configured. Enable a provider in `websearch.providers` or via env flags.",
              title: "Web Search",
              metadata,
            }
          }

          metadata.provider = provider.id

          yield* ctx.metadata({
            title: `${provider.label} "${params.query}"`,
            metadata,
          })

          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
              provider: provider.id,
            },
          })

          const result = yield* callProvider(http, provider, params, ctx)

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `${provider.label}: ${params.query}`,
            metadata,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
