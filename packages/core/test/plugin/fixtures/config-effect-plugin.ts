import { define } from "@opencode-ai/plugin/v2/effect"
import { Effect } from "effect"

export default define({
  id: "config-effect-plugin",
  effect: (ctx) =>
    ctx.hook.agent
      .transform((agents) => {
        agents.update("effect-configured", (agent) => {
          agent.description = ctx.options.description
          agent.mode = "subagent"
        })
      })
      .pipe(Effect.asVoid),
})
