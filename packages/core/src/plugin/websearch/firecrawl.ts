export * as WebSearchFirecrawl from "./firecrawl.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { App } from "../../app.js"
import { WebSearchMcp } from "./mcp.js"
import { WebSearchResponse } from "./response.js"

export const endpoint = "https://mcp.firecrawl.dev/v2/mcp"

const McpInput = Schema.Struct({
  query: Schema.String,
  limit: Schema.Number.pipe(Schema.optional),
})

const McpOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
})

const decodeSearchResponse = Schema.decodeUnknownOption(
  Schema.Struct({ data: Schema.Struct({ web: Schema.Array(Schema.Unknown) }) }),
)

const SearchResult = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String).pipe(Schema.optional),
  description: Schema.NullOr(Schema.String).pipe(Schema.optional),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.firecrawl",
  effect: Effect.fn("WebSearchFirecrawl.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("firecrawl", (integration) => (integration.name = "Firecrawl"))
      editor.method.update({
        integrationID: "firecrawl",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "firecrawl",
        method: { type: "env", names: ["FIRECRAWL_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "firecrawl",
        name: "Firecrawl",
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("firecrawl")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const response = yield* WebSearchMcp.call(
              http,
              endpoint,
              "firecrawl_search",
              { input: McpInput, output: McpOutput },
              { query: input.query, limit: 8 },
              {
                "User-Agent": App.useragent(ctx.app),
                ...(credential?.type === "key" ? { Authorization: `Bearer ${credential.key}` } : {}),
              },
            )
            const content = response.result?.content.find((item) => item.text)
            const search = content
              ? Option.getOrUndefined(
                  WebSearchResponse.json(content.text, response.truncated).pipe(Option.flatMap(decodeSearchResponse)),
                )
              : undefined
            return WebSearchResponse.items(SearchResult, search?.data.web ?? [], response.truncated).map((item) => ({
              url: item.url,
              ...(item.title ? { title: item.title } : {}),
              ...(item.description ? { content: item.description } : {}),
              time: {},
            }))
          }),
      })
    })
  }),
})
