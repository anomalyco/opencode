export * as WebSearchProvider from "./provider.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Credential } from "@opencode/schema/credential"
import type { WebSearch } from "@opencode/schema/websearch"
import { Effect } from "effect"

/** Registers a web search provider backed by an API key integration with the same ID and name. */
export const register = Effect.fn("WebSearchProvider.register")(function* (
  ctx: Context,
  provider: {
    readonly id: string
    readonly name: string
    readonly env: string
    readonly execute: (
      input: WebSearch.ProviderInput,
      credential: Credential.Value | undefined,
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
      execute: (input) =>
        Effect.gen(function* () {
          const connection = yield* ctx.integration.connection.active(provider.id)
          const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
          return yield* provider.execute(input, credential)
        }),
    })
  })
})
