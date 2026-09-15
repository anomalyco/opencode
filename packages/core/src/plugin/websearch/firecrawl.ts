export * as WebSearchFirecrawl from "./firecrawl.js"

import { define, type Context } from "@opencode/plugin/effect/plugin"
import { Effect, Option, Schema, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { App } from "../../app.js"
import { WebSearchMcp } from "./mcp.js"

export const endpoint = "https://mcp.firecrawl.dev/v2/mcp"
export const integrationID = "firecrawl"

const McpInput = Schema.Struct({
  query: Schema.String,
  limit: Schema.Number.pipe(Schema.optional),
})

const McpOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
})

const SearchResponse = Schema.fromJsonString(
  Schema.Struct({
    success: Schema.Boolean,
    data: Schema.Struct({
      web: Schema.Array(
        Schema.Struct({
          url: Schema.String,
          title: Schema.NullOr(Schema.String).pipe(Schema.optional),
          description: Schema.NullOr(Schema.String).pipe(Schema.optional),
        }),
      ),
    }),
  }),
)
const decodeSearchResponse = Schema.decodeUnknownOption(SearchResponse)

/** Calls a Firecrawl MCP tool with the active connection's credential and returns its text content. */
export const call = <F extends Schema.Struct.Fields>(
  ctx: Context,
  http: HttpClient.HttpClient,
  tool: string,
  input: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
) =>
  Effect.gen(function* () {
    const connection = yield* ctx.integration.connection.active(integrationID)
    const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
    const result = yield* WebSearchMcp.call(http, endpoint, tool, { input, output: McpOutput }, value, {
      "User-Agent": App.useragent(ctx.app),
      ...(credential?.type === "key" ? { Authorization: `Bearer ${credential.key}` } : {}),
    })
    return result?.content.find((item) => item.text)?.text
  })

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.firecrawl",
  effect: Effect.fn("WebSearchFirecrawl.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => (integration.name = "Firecrawl"))
      editor.method.update({
        integrationID,
        method: { type: "key" },
      })
      editor.method.update({
        integrationID,
        method: { type: "env", names: ["FIRECRAWL_API_KEY"] },
      })
    })
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "firecrawl",
        name: "Firecrawl",
        execute: (input) =>
          Effect.gen(function* () {
            const text = yield* call(ctx, http, "firecrawl_search", McpInput, { query: input.query, limit: 8 })
            const response = text ? Option.getOrUndefined(decodeSearchResponse(text)) : undefined
            return (
              response?.data.web.map((item) => ({
                url: item.url,
                ...(item.title ? { title: item.title } : {}),
                ...(item.description ? { content: item.description } : {}),
                time: {},
              })) ?? []
            )
          }),
      })
    })
  }),
})
