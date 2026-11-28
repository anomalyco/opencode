export * as ClaudeWebSearch from "./websearch.js"

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { WebSearch } from "@opencode/plugin/effect"
import { Effect, Option, Schema } from "effect"
import os from "node:os"
import { ClaudeAgentError } from "../language-model/claude-agent-error.js"
import type { ClaudeIO } from "./io.js"
import { ClaudeQueryOptions } from "./query-options.js"
import { ClaudeSDK } from "./sdk.js"

const SYSTEM = [
  "You are a web search relay.",
  "Call the WebSearch tool exactly once, with the user's message as the query, verbatim.",
  "Do not answer from memory and do not call any other tool.",
].join(" ")

// What Claude Code reports after WebSearch: lists of links, with Claude's notes on them as plain strings
const Output = Schema.Struct({
  results: Schema.Array(
    Schema.Union([
      Schema.String,
      Schema.Struct({ content: Schema.Array(Schema.Struct({ title: Schema.String, url: Schema.String })) }),
    ]),
  ),
})

export const search = Effect.fn("ClaudeWebSearch.search")(function* (input: {
  readonly executable: string
  readonly io: ClaudeIO.Interface
  readonly connection?: Readonly<Record<string, string>>
  readonly query: string
}) {
  return yield* Effect.acquireUseRelease(
    Effect.tryPromise(async () => {
      const { query } = await ClaudeSDK.load()
      return query({
        prompt: input.query,
        options: {
          ...ClaudeQueryOptions.base(input),
          // The search reads no files, so it runs outside the project
          cwd: os.tmpdir(),
          // WebSearch returns page contents encrypted, so a model has to run it. The cheapest one is enough.
          model: "haiku",
          systemPrompt: SYSTEM,
          thinking: { type: "disabled" },
          tools: ["WebSearch"],
          allowedTools: ["WebSearch"],
          persistSession: false,
          maxTurns: 2,
        },
      })
    }),
    (session) =>
      Effect.tryPromise(async () => {
        const failure = ClaudeAgentError.make()
        for await (const message of session) {
          const error = failure(message)
          if (error) throw error
          const found = results(message)
          if (found) return found
        }
        throw new Error("Claude finished without searching the web")
      }),
    // Closing as soon as the results arrive skips Claude's own answer. The model that asked reads the results itself.
    (session) => Effect.sync(() => session.close()),
  ).pipe(
    // opencode sets no limit on a search provider, so a stuck claude would hold the tool call forever
    Effect.timeoutOrElse({
      duration: "1 minute",
      orElse: () => Effect.fail(new Error("Claude did not finish the web search within a minute")),
    }),
  )
})

export function results(message: SDKMessage): WebSearch.Result[] | undefined {
  if (message.type !== "user") return
  const output = Schema.decodeUnknownOption(Output)(message.tool_use_result)
  if (Option.isNone(output)) return
  const found: WebSearch.Result[] = output.value.results.flatMap((item) =>
    typeof item === "string" ? [] : item.content.map((link) => ({ url: link.url, title: link.title, time: {} })),
  )
  const summary = output.value.results
    .flatMap((item) => (typeof item === "string" ? [item.trim()] : []))
    .filter(Boolean)
    .join("\n\n")
  const first = found[0]
  if (!summary || !first) return found
  // opencode lists results without a field for the whole search, so the summary rides on the first one, which says so
  found[0] = {
    ...first,
    title: `Summary of all results below, written by Claude (top source: ${first.title})`,
    content: summary,
  }
  return found
}
