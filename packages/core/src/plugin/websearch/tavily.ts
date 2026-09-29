export * as WebSearchTavily from "./tavily.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Option, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { App } from "../../app.js"
import { WebSearchResponse } from "./response.js"

export const endpoint = "https://api.tavily.com/search"

const SearchRequest = Schema.Struct({
  query: Schema.String,
  search_depth: Schema.Literal("basic"),
  chunks_per_source: Schema.Number,
  max_results: Schema.Number,
})

const decodeSearchResponse = Schema.decodeUnknownOption(Schema.Struct({ results: Schema.Array(Schema.Unknown) }))

const SearchResult = Schema.Struct({
  title: Schema.String,
  url: Schema.String,
  content: Schema.String,
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
            const body = yield* WebSearchResponse.execute(http, request).pipe(
              Effect.scoped,
              Effect.timeoutOrElse({
                duration: Duration.seconds(25),
                orElse: () => Effect.fail(new Error("Tavily web search request timed out")),
              }),
            )
            const search = WebSearchResponse.json(body.text, body.truncated).pipe(Option.flatMap(decodeSearchResponse))
            if (Option.isNone(search)) return yield* Effect.fail(new Error("Tavily returned an invalid response"))
            return WebSearchResponse.items(SearchResult, search.value.results, body.truncated).map((item) => ({
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
