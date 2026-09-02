export * as WebSearchFirecrawl from "./firecrawl.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import type { WebSearch } from "@opencode-ai/schema/websearch"
import { Effect, Option, Schema, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { App } from "../../app.js"
import { WebSearchMcp } from "./mcp.js"

export const endpoint = "https://mcp.firecrawl.dev/v2/mcp"

const McpInput = Schema.Struct({
  query: Schema.String,
  limit: Schema.Number.pipe(Schema.optional),
  categories: Schema.Array(Schema.String).pipe(Schema.optional),
})

const McpOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
})

const SearchResponse = Schema.fromJsonString(
  Schema.Struct({
    success: Schema.Boolean,
    data: Schema.Struct({
      web: Schema.Array(
        Schema.Struct({
          url: Schema.String,
          title: Schema.NullOr(Schema.String).pipe(Schema.optional),
          description: Schema.NullOr(Schema.String).pipe(Schema.optional),
        }),
      ),
    }),
  }),
)
const decodeSearchResponse = Schema.decodeUnknownOption(SearchResponse)

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.firecrawl",
  effect: Effect.fn("WebSearchFirecrawl.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((draft) => {
      draft.update("firecrawl", (integration) => (integration.name = "Firecrawl"))
      draft.method.update({
        integrationID: "firecrawl",
        method: { type: "key" },
      })
      draft.method.update({
        integrationID: "firecrawl",
        method: { type: "env", names: ["FIRECRAWL_API_KEY"] },
      })
    })
    const search =
      (categories?: readonly string[]) =>
      (input: WebSearch.ProviderInput): Effect.Effect<readonly WebSearch.Result[], unknown> =>
        Effect.gen(function* () {
          const connection = yield* ctx.integration.connection.active("firecrawl")
          const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
          const result = yield* WebSearchMcp.call(
            http,
            endpoint,
            "firecrawl_search",
            { input: McpInput, output: McpOutput },
            { query: input.query, limit: 8, ...(categories ? { categories } : {}) },
            {
              "User-Agent": App.useragent(ctx.app),
              ...(credential?.type === "key" ? { Authorization: `Bearer ${credential.key}` } : {}),
            },
          )
          const content = result?.content.find((item) => item.text)
          const response = content ? Option.getOrUndefined(decodeSearchResponse(content.text)) : undefined
          return (
            response?.data.web.map((item) => ({
              url: item.url,
              ...(item.title ? { title: item.title } : {}),
              ...(item.description ? { content: item.description } : {}),
              time: {},
            })) ?? []
          )
        })

    yield* ctx.websearch.transform((draft) => {
      draft.add({
        id: "firecrawl",
        name: "Firecrawl",
        execute: search(),
      })
      // The developer category resolves against an index of GitHub issues, merged
      // pull requests, READMEs, and curated documentation rather than the open web.
      draft.add({
        id: "firecrawl-developer",
        name: "Firecrawl Developer",
        execute: search(["developer"]),
      })
    })
  }),
})
