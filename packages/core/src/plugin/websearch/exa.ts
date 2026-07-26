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
    yield* ctx.integration.transform((draft) => {
      draft.update("exa", (integration) => (integration.name = "Exa"))
      draft.method.update({
        integrationID: "exa",
        method: { type: "key", label: "API key (optional)" },
      })
      draft.method.update({
        integrationID: "exa",
        method: { type: "env", names: ["EXA_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((draft) => {
      draft.add({
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
            return content ? parseResults(content.text) : []
          }),
      })
    })
  }),
})

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
