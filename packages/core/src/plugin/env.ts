import { Effect } from "effect"
import { PluginV2 } from "../plugin"

export const EnvPlugin = PluginV2.define({
  id: PluginV2.ID.make("env"),
  effect: Effect.gen(function* () {
    return {
      "provider.update": Effect.fn(function* (evt) {
        const key = evt.provider.env.find((item) => process.env[item])
        if (!key) return
        evt.provider.enabled = {
          via: "env",
          name: key,
        }
      }),
    }
  }),
})
