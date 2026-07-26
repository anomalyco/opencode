export * as WebSearchParallel from "./parallel"

import { define } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, Schema, Scope } from "effect"
import { HttpClient } from "effect/unstable/http"
import { InstallationVersion } from "../../installation/version"
import { WebSearchMcp } from "./mcp"

export const endpoint = "https://search.parallel.ai/mcp"

const McpInput = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  session_id: Schema.String.check(Schema.isMaxLength(100)).pipe(Schema.optional),
  model_name: Schema.String.check(Schema.isMaxLength(100)).pipe(Schema.optional),
})

const SearchResponse = Schema.Struct({
  search_id: Schema.String,
  results: Schema.Array(
    Schema.Struct({
      url: Schema.String,
      title: Schema.NullOr(Schema.String).pipe(Schema.optional),
      publish_date: Schema.NullOr(Schema.String).pipe(Schema.optional),
      excerpts: Schema.Array(Schema.String),
    }),
  ),
  warnings: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        type: Schema.Literals(["spec_validation_warning", "input_validation_warning", "warning"]),
        message: Schema.String,
        detail: Schema.NullOr(Schema.Record(Schema.String, Schema.Json)).pipe(Schema.optional),
      }),
    ),
  ).pipe(Schema.optional),
  usage: Schema.NullOr(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        count: Schema.Int,
      }),
    ),
  ).pipe(Schema.optional),
  session_id: Schema.String,
})
const McpOutput = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
  structuredContent: SearchResponse,
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.parallel",
  effect: Effect.fn("WebSearchParallel.Plugin")(function* (ctx) {
    const http = yield* HttpClient.HttpClient
    yield* ctx.integration.register({
      id: "parallel",
      name: "Parallel",
      methods: [
        { type: "key", label: "API key (optional)" },
        { type: "env", names: ["PARALLEL_API_KEY"] },
      ],
    })
    yield* ctx.websearch.register({
      id: "parallel",
      name: "Parallel",
      execute: (input, context) =>
        Effect.gen(function* () {
          const connection = yield* ctx.integration.connection.active("parallel")
          const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
          const result = yield* WebSearchMcp.call(
            http,
            endpoint,
            "web_search",
            { input: McpInput, output: McpOutput },
            {
              objective: input.query,
              search_queries: [input.query],
              ...(context.sessionID ? { session_id: context.sessionID } : {}),
            },
            {
              "User-Agent": `opencode/${InstallationVersion}`,
              ...(credential?.type === "key" ? { Authorization: `Bearer ${credential.key}` } : {}),
            },
          )
          const content = result?.content.find((item) => item.text)
          return {
            text: content?.text ?? "",
            ...(result ? { metadata: result.structuredContent } : {}),
          }
        }),
    })
  }),
})
