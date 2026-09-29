export * as WebSearchParallel from "./parallel.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { App } from "../../app.js"
import { WebSearchMcp } from "./mcp.js"
import { WebSearchResponse } from "./response.js"

export const endpoint = "https://search.parallel.ai/mcp"

const McpInput = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  model_name: Schema.String.check(Schema.isMaxLength(100)).pipe(Schema.optional),
})

const McpOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
  // Parallel sends this after a text copy of the same JSON, so a truncated response can lose it.
  structuredContent: Schema.Unknown.pipe(Schema.optional),
})

const decodeSearchResponse = Schema.decodeUnknownOption(Schema.Struct({ results: Schema.Array(Schema.Unknown) }))

const SearchResult = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String).pipe(Schema.optional),
  publish_date: Schema.NullOr(Schema.String).pipe(Schema.optional),
  excerpts: Schema.Array(Schema.String),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.parallel",
  effect: Effect.fn("WebSearchParallel.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("parallel", (integration) => (integration.name = "Parallel"))
      editor.method.update({
        integrationID: "parallel",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "parallel",
        method: { type: "env", names: ["PARALLEL_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "parallel",
        name: "Parallel",
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("parallel")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const response = yield* WebSearchMcp.call(
              http,
              endpoint,
              "web_search",
              { input: McpInput, output: McpOutput },
              {
                objective: input.query,
                search_queries: [input.query],
              },
              {
                "User-Agent": App.useragent(ctx.app),
                ...(credential?.type === "key" ? { Authorization: `Bearer ${credential.key}` } : {}),
              },
            )
            const content = response.result?.content.find((item) => item.text)
            const search = Option.getOrUndefined(
              decodeSearchResponse(
                response.result?.structuredContent ??
                  (content
                    ? Option.getOrUndefined(WebSearchResponse.json(content.text, response.truncated))
                    : undefined),
              ),
            )
            return WebSearchResponse.items(SearchResult, search?.results ?? [], response.truncated).map((item) => {
              const published = item.publish_date ? Date.parse(item.publish_date) : undefined
              return {
                url: item.url,
                ...(item.title ? { title: item.title } : {}),
                ...(item.excerpts.length ? { content: item.excerpts.join("\n\n") } : {}),
                time: { ...(published !== undefined && Number.isFinite(published) ? { published } : {}) },
              }
            })
          }),
      })
    })
  }),
})
