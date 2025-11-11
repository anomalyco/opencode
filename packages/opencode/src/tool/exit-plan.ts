import { Tool } from "./tool"
import { Permission } from "../permission"
import z from "zod"

export const ExitPlanModeTool = Tool.define("exit-plan-mode", {
  description: "Exit plan mode by presenting the plan to the user for approval",
  parameters: z.object({
    plan: z.string().describe("The complete plan in markdown format"),
  }),
  async execute(params, ctx) {
    if (ctx.agent !== "plan") {
      throw new Error("This tool is only available in plan mode")
    }

    await Permission.ask({
      type: "exit-plan-mode",
      pattern: "plan-approval",
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      title: "Review and approve this plan",
      metadata: {
        plan: params.plan,
        timestamp: Date.now(),
        switchToAgent: "build",
      },
    })

    return {
      title: "Plan approved",
      metadata: {
        switchToAgent: "build",
      },
      output: "The user has approved the plan. You may now proceed with implementation.",
    }
  },
})
