export * as WebSearchParallel from "./parallel.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Schema, Scope } from "effect"
import { HttpClient } from "effect/http"
import { App } from "../../app.js"
import { WebSearchMcp } from "./mcp.js"
import { WebSearchProvider } from "./provider.js"

export const endpoint = "https://search.parallel.ai/mcp"

const McpInput = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  model_name: Schema.String.check(Schema.isMaxLength(100)).pipe(Schema.optional),
})

const SearchResponse = Schema.Struct({
  search_id: Schema.String,
  results: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      title: Schema.NullOr(Schema.String).pipe(Schema.optional),
      publish_date: Schema.NullOr(Schema.String).pipe(Schema.optional),
      excerpts: Schema.Array(Schema.String),
    }),
  ),
  warnings: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        type: Schema.Literals(["spec_validation_warning", "input_validation_warning", "warning"]),
        message: Schema.String,
        detail: Schema.NullOr(Schema.Record(Schema.String, Schema.Json)).pipe(Schema.optional),
      }),
    ),
  ).pipe(Schema.optional),
  usage: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        count: Schema.Int,
      }),
    ),
  ).pipe(Schema.optional),
  session_id: Schema.String,
})
const McpOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
  structuredContent: SearchResponse,
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.parallel",
  effect: Effect.fn("WebSearchParallel.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* WebSearchProvider.register(ctx, {
      id: "parallel",
      name: "Parallel",
      env: "PARALLEL_API_KEY",
      execute: (input, credential) =>
        Effect.gen(function* () {
          const result = yield* WebSearchMcp.call(
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
          return (
            result?.structuredContent.results.map((item) => {
              const published = item.publish_date ? Date.parse(item.publish_date) : undefined
              return {
                url: item.url,
                ...(item.title ? { title: item.title } : {}),
                ...(item.excerpts.length ? { content: item.excerpts.join("\n\n") } : {}),
                time: { ...(published !== undefined && Number.isFinite(published) ? { published } : {}) },
              }
            }) ?? []
          )
        }),
    })
  }),
})
