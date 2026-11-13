export * as PlanPlugin from "./plan.js"

import { ToolFailure } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import path from "path"
import { Permission } from "../permission.js"

const plan = Agent.ID.make("plan")

const active = (directory: string) => `You are in Plan mode. Discuss the plan with the user directly in the conversation. Do not create or update plan files unless the user explicitly asks you to; when they do, write them only in:
${directory}

Do not modify any other files or ask a subagent to do so.

You remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.`

const inactive = `You are NO LONGER in Plan mode. The previous Plan restrictions no longer apply. Any Plan mode instructions from earlier in this conversation are no longer active.`

export const Plugin = define({
  id: "opencode.plan",
  effect: Effect.fn(function* (ctx) {
    const global = yield* Global.Service
    const directory = path.join(global.home, ".opencode", "plan")
    yield* ctx.agent.transform((editor) => {
      editor.update(plan, (item) => {
        item.name = Agent.Name.make("Plan")
        item.description = "Read-only agent for exploring the codebase and planning work before implementation."
        item.mode = "primary"
        item.instructions = { active: active(directory), inactive }
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
        item.permissions.push({ action: "edit", resource: "*", effect: "deny" })
        item.permissions.push({ action: "edit", resource: path.join(directory, "*"), effect: "allow" })
      })
    })

    yield* ctx.tool.hook("execute.after", (event) => {
      if (event.agent !== plan) return Effect.void
      if (event.status !== "error") return Effect.void
      if (event.tool !== "edit" && event.tool !== "write" && event.tool !== "patch") return Effect.void
      if (!(event.error.error instanceof Permission.BlockedError)) return Effect.void
      event.error = new ToolFailure({
        message: `Cannot use ${event.tool} to modify files outside the Plan directory: ${directory}`,
      })
      return Effect.void
    })
  }),
})
