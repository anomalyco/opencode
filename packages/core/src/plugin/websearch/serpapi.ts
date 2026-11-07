export * as WebSearchSerpApi from "./serpapi.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema, Scope } from "effect"
import { HttpClient } from "effect/http"
import { App } from "../../app.js"
import { WebSearchMcp } from "./mcp.js"

export const endpoint = "https://mcp.serpapi.com/mcp"

const McpInput = Schema.Struct({
  params: Schema.Struct({
    q: Schema.String,
    engine: Schema.Literal("google_light"),
  }),
})

const SearchResponse = Schema.fromJsonString(
  Schema.Struct({
    organic_results: Schema.Array(
      Schema.Struct({
        link: Schema.String,
        title: Schema.NullOr(Schema.String).pipe(Schema.optional),
        snippet: Schema.NullOr(Schema.String).pipe(Schema.optional),
      }),
    ).pipe(Schema.optional),
  }),
)
const decodeSearchResponse = Schema.decodeUnknownOption(SearchResponse)

const McpOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
  structuredContent: Schema.Struct({ result: Schema.String }),
  isError: Schema.optional(Schema.Boolean),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.serpapi",
  effect: Effect.fn("WebSearchSerpApi.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("serpapi", (integration) => (integration.name = "SerpApi"))
      editor.method.update({
        integrationID: "serpapi",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "serpapi",
        method: { type: "env", names: ["SERPAPI_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "serpapi",
        name: "SerpApi",
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("serpapi")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const result = yield* WebSearchMcp.call(
              http,
              endpoint,
              "search",
              { input: McpInput, output: McpOutput },
              { params: { q: input.query, engine: "google_light" } },
              {
                "User-Agent": App.useragent(ctx.app),
                ...(credential?.type === "key" ? { Authorization: `Bearer ${credential.key}` } : {}),
              },
            )
            if (!result) return yield* Effect.fail(new Error("SerpApi returned an invalid MCP response"))
            if (result.isError) return yield* Effect.fail(new Error(result.structuredContent.result))
            const response = decodeSearchResponse(result.structuredContent.result)
            if (Option.isNone(response)) return yield* Effect.fail(new Error("SerpApi returned an invalid search response"))
            return response.value.organic_results?.map((item) => ({
              url: item.link,
              ...(item.title ? { title: item.title } : {}),
              ...(item.snippet ? { content: item.snippet } : {}),
              time: {},
            })) ?? []
          }),
      })
    })
  }),
})
