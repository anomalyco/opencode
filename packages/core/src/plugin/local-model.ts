export * as LocalModelPlugin from "./local-model.js"

import { Effect } from "effect"
import { define } from "@opencode/plugin/effect/plugin"
import { LocalModel } from "@opencode/schema/local-model"
import { Provider } from "@opencode/schema/provider"
import { Flag } from "../flag.js"
import { configuredSettings } from "./provider/configured.js"
import { activeCredential } from "./provider/credential-settings.js"
import { unloadLocalModel } from "./provider/local-unload.js"

export const Plugin = define({
  id: "opencode.local-model",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.rpc
      .register(LocalModel.Definition, {
        unload: (input) =>
          Effect.gen(function* () {
            if (!(yield* Flag.enabled("local_model_unload"))) return { unloaded: false }
            const settings = yield* configuredSettings(Provider.ID.make(input.providerID)).pipe(
              Effect.orElseSucceed(() => undefined),
            )
            const active = yield* activeCredential(ctx, input.providerID).pipe(Effect.orElseSucceed(() => undefined))
            const apiKey =
              active?.credential?.type === "key"
                ? active.credential.key
                : typeof settings?.apiKey === "string"
                  ? settings.apiKey
                  : undefined
            const unloaded = yield* Effect.promise(() =>
              unloadLocalModel({
                providerID: input.providerID,
                modelID: input.modelID,
                baseURL: typeof settings?.baseURL === "string" ? settings.baseURL : undefined,
                apiKey,
                unload: typeof settings?.unload === "string" ? settings.unload : undefined,
              }),
            )
            return { unloaded }
          }).pipe(Effect.orElseSucceed(() => ({ unloaded: false }))),
      })
      .pipe(Effect.orDie)
  }),
})
