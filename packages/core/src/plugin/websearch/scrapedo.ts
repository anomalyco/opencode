export * as WebSearchScrapeDo from "./scrapedo.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { App } from "../../app.js"

export const endpoint = "https://api.scrape.do/plugin/google/search"

const SearchResponse = Schema.Struct({
  organic_results: Schema.optional(
    Schema.Array(
      Schema.Struct({
        title: Schema.String,
        link: Schema.String,
        snippet: Schema.optional(Schema.String),
      }),
    ),
  ),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.scrapedo",
  effect: Effect.fn("WebSearchScrapeDo.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("scrapedo", (integration) => (integration.name = "Scrape.do"))
      editor.method.update({
        integrationID: "scrapedo",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "scrapedo",
        method: { type: "env", names: ["SCRAPEDO_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "scrapedo",
        name: "Scrape.do",
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("scrapedo")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const url = new URL(endpoint)
            if (credential?.type === "key") url.searchParams.set("token", credential.key)
            url.searchParams.set("q", input.query)
            const request = HttpClientRequest.get(url.toString()).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeaders({
                "User-Agent": App.useragent(ctx.app),
              }),
            )
            const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
              .execute(request)
              .pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
                Effect.scoped,
                Effect.timeoutOrElse({
                  duration: Duration.seconds(25),
                  orElse: () => Effect.fail(new Error("Scrape.do web search request timed out")),
                }),
              )
            return (response.organic_results ?? []).map((item) => ({
              url: item.link,
              title: item.title,
              ...(item.snippet ? { content: item.snippet } : {}),
              time: {},
            }))
          }),
      })
    })
  }),
})