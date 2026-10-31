export * as WebSearchSearxng from "./searxng.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { App } from "../../app.js"

/**
 * SearXNG is a metasearch server the user runs, so its account is an address
 * rather than an API key: the integration offers an `external` method whose
 * form takes the server URL, and `SEARXNG_URL` covers a user who already
 * exported it. The instance has to publish the JSON format
 * (`search.formats: [html, json]` in settings.yml), otherwise it answers 403.
 */
const SearchResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      // SearXNG emits entries without a URL and `"publishedDate": null`; both
      // are filtered or ignored below instead of failing the whole response.
      url: Schema.optional(Schema.NullOr(Schema.String)),
      title: Schema.optional(Schema.NullOr(Schema.String)),
      content: Schema.optional(Schema.NullOr(Schema.String)),
      publishedDate: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
})

const DEFAULT_LIMIT = 8

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.searxng",
  effect: Effect.fn("WebSearchSearxng.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("searxng", (integration) => (integration.name = "SearXNG"))
      editor.method.update({
        integrationID: "searxng",
        method: {
          id: "server",
          type: "external",
          label: "Your SearXNG server",
          form: [
            {
              key: "url",
              type: "string",
              format: "uri",
              title: "Server URL",
              placeholder: "http://localhost:8080",
              required: true,
            },
          ],
        },
      })
      editor.method.update({
        integrationID: "searxng",
        method: { type: "env", names: ["SEARXNG_URL"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "searxng",
        name: "SearXNG",
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active("searxng")
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            const server = serverUrl(credential)
            if (!server)
              return yield* Effect.fail(
                new Error("SearXNG has no server URL yet. Set it in Settings, or export SEARXNG_URL."),
              )
            const request = HttpClientRequest.get(searchUrl(server, input.query)).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeaders({ "User-Agent": App.useragent(ctx.app) }),
            )
            const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
              .execute(request)
              .pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
                Effect.scoped,
                Effect.timeoutOrElse({
                  duration: Duration.seconds(25),
                  orElse: () => Effect.fail(new Error("SearXNG web search request timed out")),
                }),
              )
            return response.results.flatMap((item) => {
              if (!item.url || !item.url.trim()) return []
              const published = item.publishedDate ? Date.parse(item.publishedDate) : undefined
              const title = item.title?.trim() || undefined
              const content = item.content?.trim() || undefined
              return [
                {
                  url: item.url,
                  ...(title ? { title } : {}),
                  ...(content ? { content } : {}),
                  time: { ...(published !== undefined && Number.isFinite(published) ? { published } : {}) },
                },
              ]
            }).slice(0, DEFAULT_LIMIT)
          }),
      })
    })
  }),
})

const serverUrl = (credential: { type: string; metadata?: Record<string, unknown> } | undefined) => {
  const saved = credential?.type === "external" ? credential.metadata?.url : undefined
  const value = typeof saved === "string" && saved.trim() ? saved.trim() : process.env.SEARXNG_URL?.trim()
  return value || undefined
}

/** A user typing `localhost:8080` means a host, not the `localhost:` scheme. */
const searchUrl = (server: string, query: string) => {
  const base = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(server) ? server : `http://${server}`
  const url = new URL(`${base.replace(/\/+$/, "")}/search`)
  url.searchParams.set("q", query)
  url.searchParams.set("format", "json")
  return url.toString()
}
