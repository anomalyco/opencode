import { Effect } from "effect"
import { Integration } from "../../integration"
import { PluginV2 } from "../../plugin"
import { browser, manual } from "./noumena-auth"

export const NoumenaPlugin = PluginV2.define({
  id: PluginV2.ID.make("noumena"),
  effect: Effect.gen(function* () {
    const integrations = yield* Integration.Service
    yield* integrations.update((editor) => {
      editor.method.update(browser)
      editor.method.update(manual)
    })
    return {}
  }),
})
