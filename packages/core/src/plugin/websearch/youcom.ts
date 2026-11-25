export * as WebSearchYouCom from "./youcom.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Schema, Scope } from "effect"
import { HttpClient } from "effect/http"
import { App } from "../../app.js"
import { WebSearchMcp } from "./mcp.js"
import { WebSearchProvider } from "./provider.js"

export const endpoint = "https://api.you.com/mcp"
// The free profile ignores credentials, so keyed requests must use the default endpoint.
export const keylessEndpoint = `${endpoint}?profile=free`

const McpInput = Schema.Struct({
  query: Schema.String,
  count: Schema.Number,
})

const McpOutput = Schema.Struct({
  structuredContent: Schema.Struct({
    results: Schema.Struct({
      web: Schema.Array(
        Schema.Struct({
          url: Schema.String,
          title: Schema.String.pipe(Schema.optional),
          description: Schema.String.pipe(Schema.optional),
          page_age: Schema.String.pipe(Schema.optional),
          contents: Schema.Struct({ highlights: Schema.Array(Schema.String).pipe(Schema.optional) }).pipe(
            Schema.optional,
          ),
        }),
      ).pipe(Schema.optional),
    }),
  }),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.youcom",
  effect: Effect.fn("WebSearchYouCom.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* WebSearchProvider.register(ctx, {
      id: "youcom",
      name: "You.com",
      env: "YDC_API_KEY",
      execute: (input, credential) =>
        Effect.gen(function* () {
          const keyed = credential?.type === "key"
          const result = yield* WebSearchMcp.call(
            http,
            keyed ? endpoint : keylessEndpoint,
            "you-search",
            { input: McpInput, output: McpOutput },
            { query: input.query, count: 8 },
            {
              "User-Agent": App.useragent(ctx.app),
              ...(keyed ? { Authorization: `Bearer ${credential.key}` } : {}),
            },
          )
          return (
            result?.structuredContent.results.web?.map((item) => {
              const content = item.contents?.highlights?.join("\n\n") || item.description
              // page_age is normally UTC without a zone designator, which Date.parse would read as local time.
              const published = item.page_age
                ? Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(item.page_age) ? item.page_age : `${item.page_age}Z`)
                : undefined
              return {
                url: item.url,
                ...(item.title ? { title: item.title } : {}),
                ...(content ? { content } : {}),
                time: { ...(published !== undefined && Number.isFinite(published) ? { published } : {}) },
              }
            }) ?? []
          )
        }),
    })
  }),
})
