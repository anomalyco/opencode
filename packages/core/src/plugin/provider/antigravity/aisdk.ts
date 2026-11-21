export * as AntigravityAISDK from "./aisdk.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import type { AntigravitySession } from "./antigravity/session.js"
import { AntigravityLanguageModel } from "./language-model/antigravity-language-model.js"
import { AntigravityProvider } from "./provider.js"

/**
 * Hand the provider its language model.
 *
 * The provider declares the `@opencode/antigravity` package, and this hook
 * supplies the SDK that backs it, the same way the Claude Agent provider
 * supplies the Agent SDK.
 */
export const register = Effect.fn("AntigravityAISDK.register")(function* (
  ctx: Context,
  session: AntigravitySession.Interface,
) {
  yield* ctx.aisdk.hook(
    "sdk",
    (evt) =>
      Effect.sync(() => {
        if (evt.package !== AntigravityProvider.PACKAGE) return
        evt.sdk = {
          languageModel: (modelID: string) =>
            new AntigravityLanguageModel.Model(modelID, {
              run: (request, onUpdate, signal) => session.run(request, onUpdate, signal),
            }),
        }
      }),
    { providerID: AntigravityProvider.ID },
  )
})
