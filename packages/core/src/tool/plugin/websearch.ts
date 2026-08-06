export * as WebSearchTool from "./websearch"

import type { Context as PluginContext } from "@opencode-ai/plugin/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { Effect, Schema } from "effect"
import { Form } from "../../form"
import { Permission } from "../../permission"
import { WebSearch } from "../../websearch"
import { WebSearchPreference } from "../../websearch-preference"

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
    const permission = yield* Permission.Service
    const forms = yield* Form.Service
    const preference = yield* WebSearchPreference.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add({
          name,
          options: { codemode: false },
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
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              const result = yield* ctx.websearch.query(input).pipe(
                Effect.catch((error) => {
                  if (!Schema.is(WebSearch.ProviderRequiredError)(error)) return Effect.fail(error)
                  return preference
                    .synchronized(
                      Effect.gen(function* () {
                        const providers = (yield* ctx.websearch.providers()).data
                        const stored = yield* preference.get()
                        if (stored === false) return yield* new WebSearch.DisabledError()
                        if (typeof stored === "string" && providers.some((provider) => provider.id === stored))
                          return yield* Effect.void
                        const defaultProvider = providers[0]
                        if (!defaultProvider) return yield* new WebSearch.ProviderRequiredError()
                        const response = yield* forms.ask({
                          sessionID: context.sessionID,
                          title: "Web Search",
                          metadata: { kind: "websearch.provider" },
                          fields: [
                            {
                              key: "choice",
                              description: "Allow OpenCode to search the web for up-to-date information?",
                              type: "string",
                              required: true,
                              custom: false,
                              options: [
                                {
                                  value: "allow",
                                  label: `Allow web search via ${defaultProvider.name}`,
                                },
                                {
                                  value: "choose",
                                  label: "Choose another provider",
                                },
                                { value: "disable", label: "Disable web search" },
                              ],
                            },
                          ],
                        })
                        if (response.status === "cancelled")
                          return yield* Effect.fail(new Error("Web search cancelled"))
                        if (response.answer.choice === "disable") {
                          yield* preference.set(false)
                          return yield* new WebSearch.DisabledError()
                        }
                        const selection =
                          response.answer.choice === "choose"
                            ? yield* forms.ask({
                                sessionID: context.sessionID,
                                title: "Choose a web search provider",
                                metadata: { kind: "websearch.provider" },
                                fields: [
                                  {
                                    key: "provider",
                                    description: "Choose a provider for web search.",
                                    type: "string",
                                    required: true,
                                    custom: false,
                                    options: providers.map((provider) => ({
                                      value: provider.id,
                                      label: provider.name,
                                    })),
                                  },
                                ],
                              })
                            : undefined
                        if (selection?.status === "cancelled")
                          return yield* Effect.fail(new Error("Web search cancelled"))
                        const providerID = selection?.answer.provider ?? defaultProvider.id
                        if (typeof providerID !== "string" || !providers.some((provider) => provider.id === providerID))
                          return yield* new WebSearch.ProviderRequiredError()
                        return yield* preference.set(providerID)
                      }),
                    )
                    .pipe(Effect.andThen(ctx.websearch.query(input)))
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
        }),
      )
      .pipe(Effect.orDie)

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if ((yield* preference.get()) === false) delete event.tools[name]
      }),
    )
  }),
}
