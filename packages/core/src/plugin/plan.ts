export * as PlanPlugin from "./plan"

import { ToolFailure } from "@opencode-ai/ai"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent"

export const Plugin = define({
  id: "opencode.plan",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((draft) => {
      draft.update(Agent.ID.make("plan"), (item) => {
        item.name = Agent.Name.make("Plan")
        item.description = "Plan mode. Disallows all edit tools."
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
      })
    })

    yield* ctx.tool.hook("execute.before", (event) => {
      if (event.agent !== Agent.ID.make("plan")) return Effect.void
      if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return Effect.void
      return new ToolFailure({
        message:
          "You cannot perform writes while Plan is selected. Do not use edit, write, or patch. Continue planning without modifying files.",
      })
    })
  }),
})
