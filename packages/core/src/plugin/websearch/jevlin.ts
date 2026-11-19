export * as WebSearchJevlin from "./jevlin.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { App } from "../../app.js"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"

export const endpoint = "https://api.jevlin.ai/v1/search"

const id = "jevlin"
const name = "Jevlin"
const env = "JEVLIN_API_KEY"

const SearchRequest = Schema.Struct({
  query: Schema.String,
  view: Schema.Literal("merged"),
  max_results: Schema.Number,
  merged_limit: Schema.Number,
})

const SearchResponse = Schema.Struct({
  merged: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      title: Schema.optional(Schema.String),
      excerpt: Schema.optional(Schema.String),
      published: Schema.optional(Schema.NullOr(Schema.String)),
      found_by: Schema.optional(Schema.Array(Schema.Struct({ provider: Schema.String }))),
    }),
  ),
})

// Jevlin sends one query to several search engines and merges their results. Each page lists the engines that
// returned it, which is passed on to the model as the first line of the result.
const foundBy = (engines: readonly string[]) => {
  const names = [...new Set(engines)]
  return names.length ? `Found by ${names.join(", ")}.` : ""
}

export const Plugin = define<HttpClient.HttpClient | Scope.Scope | Bus.Service>({
  id: "opencode.websearch.jevlin",
  effect: Effect.fn("WebSearchJevlin.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    const bus = yield* Bus.Service
    yield* ctx.integration.transform((editor) => {
      editor.update(id, (integration) => (integration.name = name))
      editor.method.update({ integrationID: id, method: { type: "key" } })
      editor.method.update({ integrationID: id, method: { type: "env", names: [env] } })
    })

    // Jevlin has no keyless mode, so it is offered only while a key is connected. Registering it unconditionally
    // would let `random` pick a provider that fails for everyone who has not connected it.
    const connected = Effect.map(ctx.integration.connection.active(id), (connection) => connection !== undefined)
    const state = { connected: yield* connected }
    yield* ctx.websearch.transform((editor) => {
      if (!state.connected) return
      editor.add({
        id,
        name,
        execute: (input) =>
          Effect.gen(function* () {
            const connection = yield* ctx.integration.connection.active(id)
            const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
            if (credential?.type !== "key")
              return yield* Effect.fail(new Error("Jevlin web search requires an API key"))
            const request = yield* HttpClientRequest.post(endpoint).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeaders({
                "User-Agent": App.useragent(ctx.app),
                Authorization: `Bearer ${credential.key}`,
              }),
              HttpClientRequest.schemaBodyJson(SearchRequest)({
                query: input.query,
                view: "merged",
                max_results: 8,
                merged_limit: 8,
              }),
            )
            const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
              .execute(request)
              .pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
                Effect.scoped,
                Effect.timeoutOrElse({
                  duration: Duration.seconds(25),
                  orElse: () => Effect.fail(new Error("Jevlin web search request timed out")),
                }),
              )
            return response.merged.map((item) => {
              const content = [foundBy((item.found_by ?? []).map((engine) => engine.provider)), item.excerpt ?? ""]
                .filter(Boolean)
                .join("\n")
              const published = item.published ? Date.parse(item.published) : Number.NaN
              return {
                url: item.url,
                ...(item.title ? { title: item.title } : {}),
                ...(content ? { content } : {}),
                time: Number.isFinite(published) ? { published } : {},
              }
            })
          }),
      })
    })

    yield* bus.subscribe([Credential.Event.Updated, Credential.Event.Switched]).pipe(
      Stream.filter((event) => event.data.integrationID === id),
      Stream.runForEach(() =>
        Effect.gen(function* () {
          const next = yield* connected
          if (next === state.connected) return
          state.connected = next
          yield* ctx.websearch.reload()
        }),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
