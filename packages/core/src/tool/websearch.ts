export * as WebSearchTool from "./websearch"

import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { Effect, Schema } from "effect"
import { Form } from "../form"
import { KV } from "../kv"
import { PermissionV2 } from "../permission"
import { WebSearch } from "../websearch"

export const name = "websearch"
export const NO_RESULTS = "No search results found. Please try a different query."

export const description = `Search the web using the user's selected search integration. Use this for current information beyond knowledge cutoff.

The current year is ${new Date().getFullYear()}. Use this year when searching for recent information or current events.`

export const Input = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
})

const Output = Schema.Struct({
  provider: WebSearch.ID,
  results: Schema.Array(WebSearch.Result),
})
export const Plugin = {
  id: "opencode.tool.websearch",
  effect: Effect.fn("WebSearchTool.Plugin")(function* (ctx: PluginContext) {
    const permission = yield* PermissionV2.Service
    const forms = yield* Form.Service
    const kv = yield* KV.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          {
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
                const result = yield* ctx.websearch.query(input).pipe(
                  Effect.catch((error) => {
                    if (!Schema.is(WebSearch.ProviderRequiredError)(error)) return Effect.fail(error)
                    return Effect.gen(function* () {
                      const providers = (yield* ctx.websearch.providers()).data
                      if (providers.length === 0) return yield* new WebSearch.ProviderRequiredError()
                      const response = yield* forms.ask({
                        sessionID: context.sessionID,
                        title: "Choose a web search provider",
                        metadata: { kind: "websearch.provider" },
                        fields: [
                          {
                            key: "provider",
                            title: "Provider",
                            description: "This becomes your default and can be changed later in configuration.",
                            type: "string",
                            required: true,
                            custom: false,
                            options: [
                              ...providers.map((provider) => ({ value: provider.id, label: provider.name })),
                              { value: "__disable__", label: "Disable web search" },
                            ],
                          },
                        ],
                      })
                      if (response.status === "cancelled") return yield* Effect.fail(new Error("Web search cancelled"))
                      const answer = response.answer.provider
                      if (answer === "__disable__") {
                        yield* kv.set("websearch:provider", false)
                        return yield* new WebSearch.DisabledError()
                      }
                      if (typeof answer !== "string" || !providers.some((provider) => provider.id === answer))
                        return yield* new WebSearch.ProviderRequiredError()
                      yield* kv.set("websearch:provider", answer)
                      return yield* ctx.websearch.query(input)
                    })
                  }),
                )
                const output = {
                  provider: result.data.providerID,
                  results: result.data.results,
                }
                const content = output.results.length
                  ? output.results
                      .map((result) => {
                        const title = result.title ?? result.url
                        const published = result.time.published
                          ? `\nPublished: ${new Date(result.time.published).toISOString()}`
                          : ""
                        return `## [${title}](${result.url})${published}${result.content ? `\n\n${result.content}` : ""}`
                      })
                      .join("\n\n")
                  : NO_RESULTS
                return { output, content, metadata: { provider: output.provider } }
              }).pipe(
                Effect.mapError(
                  (error) => new ToolFailure({ message: `Unable to search the web for ${input.query}`, error }),
                ),
              ),
          },
          { codemode: false },
        ),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if ((yield* kv.get("websearch:provider")) === false) delete event.tools[name]
      }),
    )
  }),
}
