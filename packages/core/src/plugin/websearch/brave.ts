export * as WebSearchBrave from "./brave.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { App } from "../../app.js"

export const endpoint = "https://api.search.brave.com/res/v1/web/search"

const SearchResponse = Schema.Struct({
  web: Schema.Struct({
    results: Schema.Array(
      Schema.Struct({
        title: Schema.String.pipe(Schema.optional),
        url: Schema.String,
        description: Schema.String.pipe(Schema.optional),
        extra_snippets: Schema.Array(Schema.String).pipe(Schema.optional),
        page_age: Schema.String.pipe(Schema.optional),
      }),
    ).pipe(Schema.optional),
  }).pipe(Schema.optional),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.brave",
  effect: Effect.fn("WebSearchBrave.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("brave", (integration) => (integration.name = "Brave Search"))
      editor.method.update({
        integrationID: "brave",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "brave",
        method: { type: "env", names: ["BRAVE_API_KEY"] },
      })
    })

    const resolveKey = Effect.gen(function* () {
      const connection = yield* ctx.integration.connection.active("brave")
      if (!connection) return undefined
      const credential = yield* ctx.integration.connection
        .resolve(connection)
        .pipe(Effect.orElseSucceed(() => undefined))
      if (credential?.type !== "key") return undefined
      return credential.key.trim() || undefined
    })

    // Every Brave Search API request must carry a subscription token, so an unconfigured provider
    // could only ever fail. Registering it regardless would place it in the "random" rotation, where
    // a non-429 failure is neither cooled down nor retried against another provider. Stay out of the
    // registry until a key exists, and re-register when credentials change.
    const configured: { key: string | undefined } = { key: undefined }
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "credential.updated" || event.type === "credential.switched"),
      Stream.runForEach(() =>
        resolveKey.pipe(
          Effect.tap((key) => Effect.sync(() => (configured.key = key))),
          Effect.andThen(ctx.websearch.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Close the race between the first read and establishing the subscription.
    configured.key = yield* resolveKey

    yield* ctx.websearch.transform((editor) => {
      if (!configured.key) return
      editor.add({
        id: "brave",
        name: "Brave Search",
        execute: (input) =>
          Effect.gen(function* () {
            // Resolved per request so a key removed since registration cannot be reused.
            const key = yield* resolveKey
            if (!key)
              return yield* Effect.fail(
                new Error(
                  "Brave Search requires an API key. Set BRAVE_API_KEY or add a key to the Brave Search integration.",
                ),
              )

            const url = new URL(endpoint)
            url.searchParams.set("q", input.query)
            url.searchParams.set("count", "8")
            // Snippets are wrapped in <strong> highlight markup unless text_decorations is off, and
            // extra_snippets documents no default, so both are requested explicitly.
            url.searchParams.set("text_decorations", "false")
            url.searchParams.set("extra_snippets", "true")
            const request = HttpClientRequest.get(url.toString()).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeaders({
                "User-Agent": App.useragent(ctx.app),
                "X-Subscription-Token": key,
              }),
            )
            const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
              .execute(request)
              .pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
                Effect.scoped,
                Effect.timeoutOrElse({
                  duration: Duration.seconds(25),
                  orElse: () => Effect.fail(new Error("Brave web search request timed out")),
                }),
              )

            return (response.web?.results ?? []).map((item) => {
              const snippets = (item.extra_snippets ?? []).map((snippet) => snippet.trim()).filter(Boolean)
              const content = [item.description?.trim(), ...snippets].filter(Boolean).join("\n\n")
              const time = published(item.page_age)
              return {
                url: item.url,
                ...(item.title ? { title: item.title } : {}),
                ...(content ? { content } : {}),
                time: time !== undefined ? { published: time } : {},
              }
            })
          }),
      })
    })
  }),
})

/**
 * `page_age` is zoneless but UTC, so it needs an explicit `Z`. Brave also sends `age`, a display
 * string that varies between "September 18, 2025" and "2 weeks ago"; it never arrives without
 * `page_age`, so it would add no coverage.
 */
function published(value: string | undefined) {
  if (!value) return undefined
  const parsed = Date.parse(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`)
  return Number.isFinite(parsed) ? parsed : undefined
}
