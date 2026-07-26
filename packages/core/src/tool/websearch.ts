export * as WebSearchTool from "./websearch"

import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { Effect, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { WebSearch } from "../websearch"
import { Tool } from "./tool"

export const name = "websearch"
export const NO_RESULTS = "No search results found. Please try a different query."

export const description = `Search the web using the user's selected search integration. Use this for current information beyond knowledge cutoff.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
})

const Output = Schema.Struct({
  provider: WebSearch.ID,
  text: Schema.String,
  metadata: Schema.optional(Schema.Json),
})
export const Plugin = {
  id: "opencode.tool.websearch",
  effect: Effect.fn("WebSearchTool.Plugin")(function* (ctx: PluginContext) {
    const permission = yield* PermissionV2.Service
    const websearch = yield* WebSearch.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.make({
            description,
            input: Input,
            output: Output,
            execute: (input, context) =>
              Effect.gen(function* () {
                yield* permission.assert({
                  action: name,
                  resources: [input.query],
                  save: ["*"],
                  metadata: input,
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, callID: context.callID },
                })
                const result = yield* websearch.query({ ...input, sessionID: context.sessionID })
                const output = {
                  provider: result.providerID,
                  text: result.text || NO_RESULTS,
                  metadata: result.metadata,
                }
                return { output, content: output.text, metadata: { provider: output.provider } }
              }).pipe(
                Effect.mapError(
                  (error) => new ToolFailure({ message: `Unable to search the web for ${input.query}`, error }),
                ),
              ),
          }),
          { codemode: false },
        ),
      )
      .pipe(Effect.orDie)
  }),
}
