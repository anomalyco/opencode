export * as WebSearchLinkup from "./linkup.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { App } from "../../app.js"

export const endpoint = "https://api.linkup.so/v1/search"

const SearchRequest = Schema.Struct({
  q: Schema.String,
  depth: Schema.Literal("standard"),
  outputType: Schema.Literal("searchResults"),
  maxResults: Schema.Number,
  includeImages: Schema.Boolean,
})

const SearchResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      type: Schema.String.pipe(Schema.optional),
      name: Schema.String.pipe(Schema.optional),
      url: Schema.String,
      content: Schema.String.pipe(Schema.optional),
    }),
  ),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.linkup",
  effect: Effect.fn("WebSearchLinkup.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("linkup", (integration) => (integration.name = "Linkup"))
      editor.method.update({
        integrationID: "linkup",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "linkup",
        method: { type: "env", names: ["LINKUP_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "linkup",
        name: "Linkup",
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("linkup")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const request = yield* HttpClientRequest.post(endpoint).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeaders({
                "User-Agent": App.useragent(ctx.app),
                ...(credential?.type === "key" ? { Authorization: `Bearer ${credential.key}` } : {}),
              }),
              HttpClientRequest.schemaBodyJson(SearchRequest)({
                q: input.query,
                depth: "standard",
                outputType: "searchResults",
                maxResults: 8,
                includeImages: false,
              }),
            )
            const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
              .execute(request)
              .pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
                Effect.scoped,
                Effect.timeoutOrElse({
                  duration: Duration.seconds(25),
                  orElse: () => Effect.fail(new Error("Linkup web search request timed out")),
                }),
              )
            return response.results
              .filter((item) => item.type === undefined || item.type === "text")
              .map((item) => ({
                url: item.url,
                ...(item.name ? { title: item.name } : {}),
                ...(item.content ? { content: item.content } : {}),
                time: {},
              }))
          }),
      })
    })
  }),
})
