export * as WebSearchTavily from "./tavily.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { App } from "../../app.js"

export const endpoint = "https://api.tavily.com/search"

const SearchRequest = Schema.Struct({
  query: Schema.String,
  search_depth: Schema.Literal("basic"),
  chunks_per_source: Schema.Number,
  max_results: Schema.Number,
})

const SearchResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      url: Schema.String,
      content: Schema.String,
    }),
  ),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.tavily",
  effect: Effect.fn("WebSearchTavily.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("tavily", (integration) => (integration.name = "Tavily"))
      editor.method.update({
        integrationID: "tavily",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "tavily",
        method: { type: "env", names: ["TAVILY_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "tavily",
        name: "Tavily",
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("tavily")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const request = yield* HttpClientRequest.post(endpoint).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeaders({
                "User-Agent": App.useragent(ctx.app),
                "X-Client-Name": "opencode2",
                ...(credential?.type === "key"
                  ? { Authorization: `Bearer ${credential.key}` }
                  : { "X-Tavily-Access-Mode": "keyless" }),
              }),
              HttpClientRequest.schemaBodyJson(SearchRequest)({
                query: input.query,
                search_depth: "basic",
                chunks_per_source: 3,
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
                  orElse: () => Effect.fail(new Error("Tavily web search request timed out")),
                }),
              )
            return response.results.map((item) => ({
              url: item.url,
              title: item.title,
              ...(item.content ? { content: item.content } : {}),
              time: {},
            }))
          }),
      })
    })
  }),
})
