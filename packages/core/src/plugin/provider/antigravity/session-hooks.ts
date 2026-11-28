export * as AntigravitySessionHooks from "./session-hooks.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { AntigravityLanguageModel } from "./language-model/antigravity-language-model.js"
import { AntigravityProvider } from "./provider.js"

/**
 * Tell the language model what each request is for and which agent runs it.
 *
 * A title or a summary must not continue the session's conversation with the CLI, and the agent's
 * permission requests are checked against the rules of the OpenCode agent that runs the turn.
 */
export const register = Effect.fn("AntigravitySessionHooks.register")(function* (ctx: Context) {
  yield* ctx.session.hook(
    "model.request",
    (event) =>
      Effect.sync(() => {
        event.headers[AntigravityLanguageModel.KIND_HEADER] = event.kind
        event.headers[AntigravityLanguageModel.AGENT_HEADER] = event.agent
      }),
    { providerID: AntigravityProvider.ID },
  )
  // The CLI retries its own API failures, and replaying a turn would run the agent's tools again.
  yield* ctx.session.hook(
    "retry",
    (event) =>
      Effect.sync(() => {
        event.decision = { retry: false }
      }),
    { providerID: AntigravityProvider.ID },
  )
})
