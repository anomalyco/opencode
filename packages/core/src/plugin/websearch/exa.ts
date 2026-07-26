export * as WebSearchExa from "./exa"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Schema, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { WebSearchMcp } from "./mcp"

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

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.exa",
  effect: Effect.fn("WebSearchExa.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.register({
      id: "exa",
      name: "Exa",
      methods: [
        { type: "key", label: "API key (optional)" },
        { type: "env", names: ["EXA_API_KEY"] },
      ],
    })
    yield* ctx.websearch.register({
      id: "exa",
      name: "Exa",
      execute: (input) =>
        Effect.gen(function* () {
          const connection = yield* ctx.integration.connection.active("exa")
          const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
          const url = new URL(endpoint)
          if (credential?.type === "key") url.searchParams.set("exaApiKey", credential.key)
          const result = yield* WebSearchMcp.call(
            http,
            url.toString(),
            "web_search_exa",
            { input: McpInput, output: McpOutput },
            { query: input.query, numResults: 8 },
          )
          const content = result?.content.find((item) => item.text)
          return {
            text: content?.text ?? "",
            ...(content?._meta ? { metadata: content._meta } : {}),
          }
        }),
    })
  }),
})
