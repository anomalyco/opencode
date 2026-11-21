export * as WebSearchProvider from "./provider.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { WebSearch } from "@opencode/schema/websearch"
import { Effect } from "effect"
import { WebSearchProviderSettings } from "./settings.js"

/** Registers a web search provider backed by an API key integration with the same ID and name. */
export const register = Effect.fn("WebSearchProvider.register")(function* (
  ctx: Context,
  provider: {
    readonly id: string
    readonly name: string
    readonly env: string
    readonly endpoint: string
    readonly execute: (
      input: WebSearch.ProviderInput,
      connection: WebSearchProviderSettings.Connection,
    ) => Effect.Effect<readonly WebSearch.Result[], unknown>
  },
) {
  yield* ctx.integration.transform((editor) => {
    editor.update(provider.id, (integration) => (integration.name = provider.name))
    editor.method.update({
      integrationID: provider.id,
      method: { type: "key" },
    })
    editor.method.update({
      integrationID: provider.id,
      method: { type: "env", names: [provider.env] },
    })
  })
  yield* ctx.websearch.transform((editor) => {
    editor.add({
      id: provider.id,
      name: provider.name,
      execute: (input, settings) =>
        Effect.gen(function* () {
          const connection = yield* WebSearchProviderSettings.resolve(
            ctx.integration,
            provider.id,
            settings,
            provider.endpoint,
          )
          return yield* provider.execute(input, connection)
        }),
    })
  })
})
