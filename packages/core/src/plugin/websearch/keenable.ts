export * as WebSearchKeenable from "./keenable.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { App } from "../../app.js"
import { WebSearchProvider } from "./provider.js"

/** Keyed Search API endpoint. */
export const endpoint = "https://api.keenable.ai/v1/search"
/** Keyless endpoint: same body and response, rate limited per IP, requires `X-Keenable-Title`. */
export const publicEndpoint = "https://api.keenable.ai/v1/search/public"

const SearchRequest = Schema.Struct({
  query: Schema.String,
  max_results: Schema.Number,
})

const SearchResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      title: Schema.String,
      snippet: Schema.String.pipe(Schema.optional),
      published_at: Schema.NullOr(Schema.String).pipe(Schema.optional),
    }),
  ),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.keenable",
  effect: Effect.fn("WebSearchKeenable.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* WebSearchProvider.register(ctx, {
      id: "keenable",
      name: "Keenable",
      env: "KEENABLE_API_KEY",
      execute: (input, credential) =>
        Effect.gen(function* () {
          const keyed = credential?.type === "key"
          const request = yield* HttpClientRequest.post(keyed ? endpoint : publicEndpoint).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.setHeaders({
              "User-Agent": App.useragent(ctx.app),
              ...(keyed ? { "X-API-Key": credential.key } : { "X-Keenable-Title": "opencode" }),
            }),
            HttpClientRequest.schemaBodyJson(SearchRequest)({
              query: input.query,
              max_results: 8,
            }),
          )
          const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
            .execute(request)
            .pipe(
              Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
              Effect.scoped,
              Effect.timeoutOrElse({
                duration: Duration.seconds(25),
                orElse: () => Effect.fail(new Error("Keenable web search request timed out")),
              }),
            )
          return response.results.map((item) => {
            const published = item.published_at ? Date.parse(item.published_at) : undefined
            return {
              url: item.url,
              ...(item.title ? { title: item.title } : {}),
              ...(item.snippet ? { content: item.snippet } : {}),
              time: { ...(published !== undefined && Number.isFinite(published) ? { published } : {}) },
            }
          })
        }),
    })
  }),
})
