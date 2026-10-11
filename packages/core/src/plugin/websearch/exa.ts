export * as WebSearchExa from "./exa.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { WebSearchMcp } from "./mcp.js"
import { WebSearchProviderSettings } from "./settings.js"

export const endpoint = "https://mcp.exa.ai/mcp"

const McpInput = Schema.Struct({
  query: Schema.String,
  numResults: Schema.Number.pipe(Schema.optional),
})

const McpOutput = Schema.Struct({
  content: Schema.Array(
    Schema.Struct({
      type: Schema.Literal("text"),
      text: Schema.String,
      _meta: Schema.Struct({ searchTime: Schema.Number }).pipe(Schema.optional),
    }),
  ),
})

const RestRequest = Schema.Struct({
  query: Schema.String,
  numResults: Schema.Number,
  contents: Schema.Struct({ text: Schema.Boolean }),
})

const RestResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      title: Schema.NullOr(Schema.String).pipe(Schema.optional),
      publishedDate: Schema.NullOr(Schema.String).pipe(Schema.optional),
      text: Schema.NullOr(Schema.String).pipe(Schema.optional),
      highlights: Schema.NullOr(Schema.Array(Schema.String)).pipe(Schema.optional),
    }),
  ),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.exa",
  effect: Effect.fn("WebSearchExa.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update("exa", (integration) => (integration.name = "Exa"))
      editor.method.update({
        integrationID: "exa",
        method: { type: "key" },
      })
      editor.method.update({
        integrationID: "exa",
        method: { type: "env", names: ["EXA_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "exa",
        name: "Exa",
        execute: (input, settings) =>
          Effect.gen(function* () {
            if (settings?.endpoint) return yield* callRest(http, settings.endpoint, settings.apiKey, input.query)
            const resolved = yield* WebSearchProviderSettings.resolve(ctx.integration, "exa", settings, endpoint)
            const url = new URL(resolved.endpoint)
            if (resolved.key) url.searchParams.set("exaApiKey", resolved.key)
            const result = yield* WebSearchMcp.call(
              http,
              url.toString(),
              "web_search_exa",
              { input: McpInput, output: McpOutput },
              { query: input.query, numResults: 8 },
            )
            const content = result?.content.find((item) => item.text)
            return content ? parseResults(content.text) : []
          }),
      })
    })
  }),
})

function callRest(http: HttpClient.HttpClient, url: string, apiKey: string | undefined, query: string) {
  return Effect.gen(function* () {
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeaders(apiKey ? { "x-api-key": apiKey } : {}),
      HttpClientRequest.schemaBodyJson(RestRequest)({
        query,
        numResults: 8,
        contents: { text: true },
      }),
    )
    const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
      .execute(request)
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(RestResponse)),
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: Duration.seconds(25),
          orElse: () => Effect.fail(new Error("Exa web search request timed out")),
        }),
      )
    return response.results.map((item) => {
      const published = item.publishedDate ? Date.parse(item.publishedDate) : undefined
      const content = item.text ?? item.highlights?.join("\n\n")
      return {
        url: item.url,
        ...(item.title ? { title: item.title } : {}),
        ...(content ? { content } : {}),
        time: { ...(published !== undefined && Number.isFinite(published) ? { published } : {}) },
      }
    })
  })
}

function parseResults(text: string) {
  return text.split(/\n\n---\n\n/).flatMap((block) => {
    const url = block.match(/^URL:\s*(.+)$/m)?.[1]?.trim()
    if (!url) return []
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim()
    const publishedText = block.match(/^Published:\s*(.+)$/m)?.[1]?.trim()
    const published = publishedText && publishedText !== "N/A" ? Date.parse(publishedText) : undefined
    const content = block.match(/^(?:Highlights|Text):\s*\n?([\s\S]*)$/m)?.[1]?.trim()
    return [
      {
        url,
        ...(title && title !== "N/A" ? { title } : {}),
        ...(content ? { content } : {}),
        time: { ...(published !== undefined && Number.isFinite(published) ? { published } : {}) },
      },
    ]
  })
}
