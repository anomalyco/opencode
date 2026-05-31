import { Effect } from "effect"
import { PluginV2 } from "../plugin"

export const EnvPlugin = PluginV2.define({
  id: PluginV2.ID.make("env"),
  effect: Effect.gen(function* () {
    return {
      "catalog.transform": Effect.fn(function* (evt) {
        for (const item of evt.provider.list()) {
          const key = item.provider.env.find((env) => process.env[env])
          if (!key) continue
          evt.provider.update(item.provider.id, (provider) => {
            provider.enabled = {
              via: "env",
              name: key,
            }
          })
        }
      }),
    }
  }),
})
