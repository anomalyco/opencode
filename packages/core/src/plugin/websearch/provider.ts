export * as WebSearchProvider from "./provider.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { Credential } from "@opencode/schema/credential"
import { WebSearch } from "@opencode/schema/websearch"
import { Effect } from "effect"
import { WebSearch as WebSearchService } from "../../websearch.js"

type Definition = {
  readonly id: string
  readonly name: string
  readonly env: string
  readonly execute: (
    input: WebSearch.ProviderInput,
    credential: Credential.Value | undefined,
  ) => Effect.Effect<readonly WebSearch.Result[], unknown>
}

/** Registers a web search provider backed by an API key integration with the same ID and name. */
export const register = Effect.fn("WebSearchProvider.register")(function* (ctx: Context, provider: Definition) {
  yield* registerIntegration(ctx, provider)
  yield* ctx.websearch.transform((editor) => {
    editor.add({ id: provider.id, name: provider.name, execute: execute(ctx, provider) })
  })
})

/** Like `register`, but the provider is only used when chosen by ID, never by `random` selection. */
export const registerExplicit = Effect.fn("WebSearchProvider.registerExplicit")(function* (
  ctx: Context,
  provider: Definition,
) {
  yield* registerIntegration(ctx, provider)
  // The plugin SDK cannot opt a provider out of random selection, so this goes through the core service.
  const websearch = yield* WebSearchService.Service
  yield* websearch.transform((editor) => {
    editor.add({
      id: WebSearch.ID.make(provider.id),
      name: provider.name,
      random: false,
      execute: execute(ctx, provider),
    })
  })
})

function registerIntegration(ctx: Context, provider: Definition) {
  return ctx.integration.transform((editor) => {
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
}

function execute(ctx: Context, provider: Definition) {
  return (input: WebSearch.ProviderInput) =>
    Effect.gen(function* () {
      const connection = yield* ctx.integration.connection.active(provider.id)
      const credential = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
      return yield* provider.execute(input, credential)
    })
}
