export * as ClaudeAISDK from "./aisdk.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import type { ClaudeSessions } from "../claude/sessions.js"
import { ClaudeAgentLanguageModel } from "../language-model/claude-agent-language-model.js"
import { ClaudeProvider } from "./provider.js"

export const register = Effect.fn("ClaudeAISDK.register")(function* (ctx: Context, sessions: ClaudeSessions.Interface) {
  const context = yield* Effect.context<never>()
  const run = Effect.runPromiseWith(context)
  const dependencies: ClaudeAgentLanguageModel.Dependencies = {
    run: (request, signal) => run(sessions.run(request), { signal }),
  }
  yield* ctx.aisdk.hook(
    "sdk",
    (evt) =>
      Effect.sync(() => {
        if (evt.package !== ClaudeProvider.PACKAGE) return
        evt.sdk = {
          languageModel: (modelID: string) => new ClaudeAgentLanguageModel.Model(modelID, dependencies),
        }
      }),
    { providerID: ClaudeProvider.ID },
  )
})
