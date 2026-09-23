export * as AlexandriaTool from "./alexandria.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { ToolFailure } from "@opencode/ai"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientError } from "effect/unstable/http"
import { Permission } from "../../permission.js"
import { WebSearchFirecrawl } from "../../plugin/websearch/firecrawl.js"

export const name = "alexandria"
export const NO_PROVIDERS = "No Alexandria providers matched. Try describing the data differently or use websearch."
export const NO_DATA = "The capability returned no data."
export const NOT_CONNECTED = "Alexandria needs a Firecrawl connection. Connect the Firecrawl integration to enable it."
export const INVALID_INPUT = "Pass either query (to find providers) or provider and capability (to run one), not both."
export const TOO_LARGE =
  "The Alexandria result was too large for this tool. Narrow the request with the capability's paging or filter options."
const httpErrors = new Map([
  [429, "Alexandria rate limited (HTTP 429)"],
  [401, "Alexandria authentication failed (HTTP 401)"],
  [402, "Alexandria execution needs Firecrawl credits (HTTP 402)"],
  [403, "Alexandria access or provider terms required (HTTP 403)"],
])

export const description = `Find and run catalogued data providers (official APIs, licensed publishers, Firecrawl indexes) through Firecrawl Alexandria. Pass query to discover capabilities with their input contracts and prices; discovery is free. Pass provider and capability (plus options matching the contract) to run one; running spends Firecrawl credits and returns structured records.

Discover first and only run a capability that discovery returned. Check each result item for an error before using it.`

export const Input = Schema.Struct({
  query: Schema.optionalKey(Schema.String).annotate({
    description: "What data you need, in plain words; returns matching providers and capabilities",
  }),
  provider: Schema.optionalKey(Schema.String).annotate({
    description: 'Provider slug returned by discovery, e.g. "fred"',
  }),
  capability: Schema.optionalKey(Schema.String).annotate({
    description: 'Capability address returned by discovery, e.g. "series/observations"',
  }),
  options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)).annotate({
    description: "Options matching the capability's contract",
  }),
})

const FindInput = Schema.Struct({
  query: Schema.String,
  sources: Schema.Array(Schema.String),
  limit: Schema.Number,
  toolDetail: Schema.String,
})

const RunInput = Schema.Struct({
  alexandria: Schema.Struct({
    provider: Schema.String,
    capability: Schema.String,
    options: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
})

const Output = Schema.Struct({
  output: Schema.String,
})

export const Plugin = {
  id: "opencode.tool.alexandria",
  effect: Effect.fn("AlexandriaTool.Plugin")(function* (ctx: Context) {
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
              const query = input.query?.trim()
              const target = input.provider && input.capability ? `${input.provider}/${input.capability}` : undefined
              // Exactly one mode: a query finds providers; a provider plus capability runs one.
              if (!query === !target) return yield* new ToolFailure({ message: INVALID_INPUT })
              yield* permission.assert({
                action: name,
                resources: [query ?? target!],
                save: ["*"],
                metadata: input,
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const text = query
                ? yield* WebSearchFirecrawl.call(ctx, http, "firecrawl_search", FindInput, {
                    query,
                    sources: ["alexandria"],
                    // Full detail carries each capability's input contract, so the model can run it without guessing options.
                    limit: 5,
                    toolDetail: "full",
                  })
                : yield* WebSearchFirecrawl.call(ctx, http, "firecrawl_scrape", RunInput, {
                    alexandria: {
                      provider: input.provider!,
                      capability: input.capability!,
                      ...(input.options ? { options: input.options } : {}),
                    },
                  })
              const output = text?.trim() || (query ? NO_PROVIDERS : NO_DATA)
              return { output: { output }, content: output }
            }).pipe(
              Effect.mapError((error) => {
                if (error instanceof ToolFailure) return error
                const status = HttpClientError.isHttpClientError(error) ? error.response?.status : undefined
                const subject = input.query ?? `${input.provider}/${input.capability}`
                if (error instanceof Error && error.message.includes("exceeded"))
                  return new ToolFailure({ message: TOO_LARGE, error })
                return new ToolFailure({
                  message:
                    status === undefined
                      ? `Unable to reach Alexandria for ${subject}`
                      : (httpErrors.get(status) ?? `Alexandria request failed (HTTP ${status})`),
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
