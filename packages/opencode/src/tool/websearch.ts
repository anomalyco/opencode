import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./websearch.txt"
import { checksum } from "@opencode-ai/core/util/encode"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { RuntimeFlags } from "@/effect/runtime-flags"

const PARALLEL_ADDITIONAL_QUERIES_MIN = 1
const PARALLEL_ADDITIONAL_QUERIES_MAX = 2

const baseFields = {
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
}

const parallelOnlyFields = {
  objective: Schema.String.annotate({
    description:
      "A natural-language description of what you're trying to accomplish (e.g. 'Compare Q1 2026 earnings and margin performance for Tesla, Ford, and GM'). Must include the key entities or topics being researched. The search engine uses this to rank results for reasoning utility rather than human engagement.",
  }),
  additionalQueries: Schema.Array(Schema.String)
    .check(Schema.isMinLength(PARALLEL_ADDITIONAL_QUERIES_MIN), Schema.isMaxLength(PARALLEL_ADDITIONAL_QUERIES_MAX))
    .annotate({
      description: `${PARALLEL_ADDITIONAL_QUERIES_MIN}-${PARALLEL_ADDITIONAL_QUERIES_MAX} additional keyword search queries (3-6 words each) to run alongside \`query\` in a single batched call. Must be diverse — vary entity names, synonyms, and angles. Each query must include the key entity or topic. NEVER write sentences, instructions, or use site: operators. Use this instead of chaining separate websearch calls for multi-topic questions.`,
    }),
}

// Model-facing schema when Parallel is in play — both extras required.
export const ParallelParameters = Schema.Struct({ ...baseFields, ...parallelOnlyFields })

// Model-facing schema when Parallel is gated out — no extras at all.
export const BaseParameters = Schema.Struct(baseFields)

// Execute-side type: extras may be present or absent depending on which
// model-facing schema was active for the session.
export const Parameters = Schema.Struct({
  ...baseFields,
  objective: Schema.optional(parallelOnlyFields.objective),
  additionalQueries: Schema.optional(parallelOnlyFields.additionalQueries),
})

const WebSearchProviderSchema = Schema.Literals(["exa", "parallel"])
export type WebSearchProvider = Schema.Schema.Type<typeof WebSearchProviderSchema>

export function selectWebSearchProvider(sessionID: string, flags = { exa: false, parallel: false }): WebSearchProvider {
  const override = process.env.OPENCODE_WEBSEARCH_PROVIDER
  if (override === "exa" || override === "parallel") return override
  if (flags.parallel) return "parallel"
  if (flags.exa) return "exa"

  return Number.parseInt(checksum(sessionID) ?? "0", 36) % 2 === 0 ? "exa" : "parallel"
}

/**
 * Whether Parallel-only schema fields (`objective`, `additionalQueries`) should
 * be exposed to the model. Strict: only when Parallel is the resolved provider
 * via env override or runtime flag. The 50/50 rollout fallback hides them so
 * the model isn't asked for inputs that would be dropped on Exa sessions.
 */
export function shouldExposeParallelExtras(
  flags: { exa: boolean; parallel: boolean },
  override = process.env.OPENCODE_WEBSEARCH_PROVIDER,
) {
  if (override === "parallel") return true
  if (override === "exa") return false
  return flags.parallel
}

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
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

function parallelAuthHeaders() {
  const headers = { "User-Agent": `opencode/${InstallationVersion}` }
  if (!process.env.PARALLEL_API_KEY) return headers
  return { ...headers, Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
) {
  if (provider === "parallel") {
    return McpWebSearch.call(
      http,
      McpWebSearch.PARALLEL_URL,
      "web_search",
      McpWebSearch.ParallelSearchArgs,
      {
        objective: params.objective ?? params.query,
        search_queries: [params.query, ...(params.additionalQueries ?? [])],
        session_id: ctx.sessionID,
        model_name: webSearchModelName(ctx.extra),
      },
      "25 seconds",
      parallelAuthHeaders(),
    )
  }

  return McpWebSearch.call(
    http,
    McpWebSearch.EXA_URL,
    "web_search_exa",
    McpWebSearch.SearchArgs,
    {
      query: params.query,
      type: params.type || "auto",
      numResults: params.numResults || 8,
      livecrawl: params.livecrawl || "fallback",
      contextMaxCharacters: params.contextMaxCharacters,
    },
    "25 seconds",
  )
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service

    const exposeParallelExtras = shouldExposeParallelExtras({
      exa: flags.enableExa,
      parallel: flags.enableParallel,
    })

    const parallelGuidance = [
      "",
      "PREFER OVER REPEATED KEYWORD SEARCHES — one call covers the ground of 2-3 traditional queries with better relevance. Returns LLM-optimized excerpts (pre-compressed, citation-aware).",
      "",
      "Required fields when calling:",
      "  - `objective`: natural-language description of what you're trying to accomplish. Must name the key entities or topics.",
      `  - \`additionalQueries\`: ${PARALLEL_ADDITIONAL_QUERIES_MIN}-${PARALLEL_ADDITIONAL_QUERIES_MAX} diverse keyword queries (3-6 words each) to run alongside \`query\` in a single batched call. Vary entities, synonyms, and angles. Do NOT chain multiple websearch calls when one batched call would do.`,
    ].join("\n")

    return {
      get description() {
        const base = DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
        return exposeParallelExtras ? `${base}\n${parallelGuidance}` : base
      },
      parameters: exposeParallelExtras ? ParallelParameters : BaseParameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const provider = selectWebSearchProvider(ctx.sessionID, {
            exa: flags.enableExa,
            parallel: flags.enableParallel,
          })
          const title = webSearchProviderLabel(provider)
          yield* ctx.metadata({ title: `${title} "${params.query}"`, metadata: { provider } })

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
              provider,
            },
          })

          const result = yield* callProvider(http, provider, params, ctx)

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `${title}: ${params.query}`,
            metadata: { provider },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
