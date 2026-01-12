import z from "zod"
import { Tool } from "./tool"
import { Plan } from "../session/plan"
import { PlanReview } from "../session/plan-review"
import { MessageV2 } from "../session/message-v2"
import { Session } from "../session"
import { PermissionNext } from "../permission/next"
import DESCRIPTION from "./exit-plan-mode.txt"

export const ExitPlanModeTool = Tool.define("exit_plan_mode", {
  description: DESCRIPTION,
  parameters: z.object({}),
  async execute(_params, ctx) {
    // Get or create the plan for this session
    const plan = await Plan.getOrCreate(ctx.sessionID)

    // Update plan status to pending_review
    await Plan.setStatus(ctx.sessionID, "pending_review")

    // Request review from the user - this blocks until they respond
    const result = await PlanReview.request({
      sessionID: ctx.sessionID,
      planID: plan.id,
      filePath: plan.filePath,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    if (result.status === "approved") {
      // Update plan status
      await Plan.setStatus(ctx.sessionID, "approved")

      // Update the user message's agent from "plan" to "build"
      // This triggers the agent transition in the loop
      const msgs = await MessageV2.filterCompacted(MessageV2.stream(ctx.sessionID))
      for (let i = msgs.length - 1; i >= 0; i--) {
        const msg = msgs[i]
        if (msg.info.role === "user") {
          const userMsg = msg.info as MessageV2.User
          await Session.updateMessage({
            ...userMsg,
            agent: "build",
          })
          break
        }
      }

      return {
        title: "Plan approved",
        output:
          "Your plan has been approved by the user. You are now in build mode. Proceed to implement the plan step by step.",
        metadata: {
          status: "approved",
          planID: plan.id,
          filePath: plan.filePath,
        } as { status: string; planID: string; filePath: string; feedback?: string },
      }
    } else if (result.feedback) {
      // Plan was rejected with feedback - let AI revise
      await Plan.setStatus(ctx.sessionID, "rejected")

      return {
        title: "Plan rejected - revision requested",
        output: `The user rejected your plan with the following feedback:\n\n${result.feedback}\n\nPlease revise your plan based on this feedback and call exit_plan_mode again when ready.`,
        metadata: {
          status: "rejected",
          planID: plan.id,
          filePath: plan.filePath,
          feedback: result.feedback,
        } as { status: string; planID: string; filePath: string; feedback?: string },
      }
    } else {
      // Plan was dismissed without feedback - interrupt the conversation
      await Plan.setStatus(ctx.sessionID, "rejected")

      // Throw RejectedError to interrupt the agent loop
      throw new PermissionNext.RejectedError()
    }
  },
})
