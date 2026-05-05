import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Tool from "./tool"
import * as McpExa from "./mcp-exa"
import * as McpPerplexity from "./mcp-perplexity"
import DESCRIPTION from "./websearch.txt"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(Schema.Number).annotate({
    description: "Number of search results to return (default: 8)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback'). Exa-only; ignored when Perplexity backend is in use.",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description:
      "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search. Exa-only; ignored when Perplexity backend is in use.",
  }),
  contextMaxCharacters: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000)",
  }),
})

// Backend selection precedence:
//   1. Perplexity (default) — when PERPLEXITY_API_KEY (or PPLX_API_KEY) is set
//      and OPENCODE_DISABLE_PERPLEXITY is not set.
//   2. Exa — when OPENCODE_ENABLE_EXA is set or the hosted opencode provider is in use.
//   3. Otherwise the websearch tool is not registered (see registry.ts).
function usePerplexityBackend() {
  return Flag.OPENCODE_ENABLE_PERPLEXITY && !!(process.env.PERPLEXITY_API_KEY ?? process.env.PPLX_API_KEY)
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
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
            },
          })

          const result = usePerplexityBackend()
            ? yield* McpPerplexity.call(
                http,
                {
                  query: params.query,
                  numResults: params.numResults || 8,
                  contextMaxCharacters: params.contextMaxCharacters,
                },
                "25 seconds",
              )
            : yield* McpExa.call(
                http,
                "web_search_exa",
                McpExa.SearchArgs,
                {
                  query: params.query,
                  type: params.type || "auto",
                  numResults: params.numResults || 8,
                  livecrawl: params.livecrawl || "fallback",
                  contextMaxCharacters: params.contextMaxCharacters,
                },
                "25 seconds",
              )

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `Web search: ${params.query}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
