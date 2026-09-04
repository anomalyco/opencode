export * as WebSearchKeenable from "./keenable.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { App } from "../../app.js"

export const endpoint = "https://api.keenable.ai/v1/search/public"
export const keyedEndpoint = "https://api.keenable.ai/v1/search"

const SearchRequest = Schema.Struct({
  query: Schema.String,
  max_results: Schema.Number,
  snippet_max_length: Schema.Number,
})

const SearchResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      title: Schema.NullOr(Schema.String).pipe(Schema.optional),
      snippet: Schema.NullOr(Schema.String).pipe(Schema.optional),
      description: Schema.NullOr(Schema.String).pipe(Schema.optional),
      published_at: Schema.NullOr(Schema.String).pipe(Schema.optional),
    }),
  ),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.keenable",
  effect: Effect.fn("WebSearchKeenable.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("keenable", (integration) => (integration.name = "Keenable"))
      editor.method.update({
        integrationID: "keenable",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "keenable",
        method: { type: "env", names: ["KEENABLE_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "keenable",
        name: "Keenable",
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("keenable")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const keyed = credential?.type === "key"
            const request = yield* HttpClientRequest.post(keyed ? keyedEndpoint : endpoint).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeaders({
                "User-Agent": App.useragent(ctx.app),
                "X-Keenable-Title": "opencode",
                ...(keyed ? { Authorization: `Bearer ${credential.key}` } : {}),
              }),
              HttpClientRequest.schemaBodyJson(SearchRequest)({
                query: input.query,
                max_results: 8,
                snippet_max_length: 1000,
              }),
            )
            const response = yield* HttpClient.filterStatusOk(http)
              .execute(request)
              .pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
                Effect.timeoutOrElse({
                  duration: Duration.seconds(25),
                  orElse: () => Effect.fail(new Error("Keenable web search request timed out")),
                }),
              )
            return response.results.map((item) => {
              const content = item.snippet || item.description
              const published = item.published_at ? Date.parse(item.published_at) : undefined
              return {
                url: item.url,
                ...(item.title ? { title: item.title } : {}),
                ...(content ? { content } : {}),
                time: published !== undefined && Number.isFinite(published) ? { published } : {},
              }
            })
          }),
      })
    })
  }),
})
