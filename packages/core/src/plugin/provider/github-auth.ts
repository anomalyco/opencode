import { Effect } from "effect"
import type { PluginContext } from "@opencode-ai/plugin/v2/effect"
import { define } from "@opencode-ai/plugin/v2/effect/plugin"

export const GitHubAuthPlugin = define({
  id: "github-auth",
  effect: Effect.fn(function* (ctx: PluginContext) {
    yield* ctx.integration.transform((draft) => {
      draft.update("github", (integration) => {
        integration.name = "GitHub"
      })
      draft.method.update({
        integrationID: "github",
        method: {
          type: "key",
          label: "Personal Access Token",
        },
      })
    })
  }),
})
