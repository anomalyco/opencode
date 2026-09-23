export * as DevSearchTool from "./devsearch.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientError } from "effect/unstable/http"
import { Permission } from "../../permission.js"
import { WebSearchFirecrawl } from "../../plugin/websearch/firecrawl.js"

export const name = "devsearch"
export const NO_RESULTS = "No developer search results found. Please try a different query."
export const NOT_CONNECTED =
  "Developer search needs a Firecrawl connection. Connect the Firecrawl integration to enable it."
const httpErrors = new Map([
  [429, "Developer search rate limited (HTTP 429)"],
  [401, "Developer search authentication failed (HTTP 401)"],
])

export const description = `Search an index built for coding agents: repositories, GitHub issues, merged pull requests, READMEs, and curated documentation sites. Use this for how a library or API behaves, what an error message means, or whether a bug was fixed. Results include the matched passages.

Prefer this over websearch for programming questions. Use websearch for current events and anything outside software.`

export const Input = Schema.Struct({
  query: Schema.String.annotate({
    description: "Developer question or search phrase, including the library, error message, or API involved",
  }),
})

const McpInput = Schema.Struct({
  query: Schema.String,
  k: Schema.Number.pipe(Schema.optional),
})

const Output = Schema.Struct({
  output: Schema.String,
})

export const Plugin = {
  id: "opencode.tool.devsearch",
  effect: Effect.fn("DevSearchTool.Plugin")(function* (ctx: Context) {
    const http = yield* HttpClient.HttpClient
    const permission = yield* Permission.Service
    // An exported FIRECRAWL_API_KEY resolves as an active connection, so it counts as connected too.
    const connected = ctx.integration.connection.active(WebSearchFirecrawl.integrationID).pipe(
      Effect.map((connection) => connection !== undefined),
      Effect.orElseSucceed(() => false),
    )

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input, context) =>
            Effect.gen(function* () {
              if (!(yield* connected)) return yield* new ToolFailure({ message: NOT_CONNECTED })
              yield* permission.assert({
                action: name,
                resources: [input.query],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const text = yield* WebSearchFirecrawl.call(ctx, http, "firecrawl_developer_search", McpInput, {
                query: input.query,
                k: 8,
              })
              const output = text?.trim() || NO_RESULTS
              return { output: { output }, content: output }
            }).pipe(
              Effect.mapError((error) => {
                if (error instanceof ToolFailure) return error
                const status = HttpClientError.isHttpClientError(error) ? error.response?.status : undefined
                return new ToolFailure({
                  message:
                    status === undefined
                      ? `Unable to search developer sources for ${input.query}`
                      : (httpErrors.get(status) ?? `Developer search request failed (HTTP ${status})`),
                  error,
                })
              }),
            ),
        }),
      )
      .pipe(Effect.orDie)

    // Sessions only see the tool once Firecrawl is connected; a stale tool list still fails clearly above.
    const hook = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        if (yield* connected) return
        delete event.tools[name]
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
}
