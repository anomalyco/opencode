import z from "zod"
import { Tool } from "./tool"
import { ModeSwitch } from "../mode-switch"
import DESCRIPTION from "./modeswitch.txt"

export const ModeSwitchTool = Tool.define("modeswitch", {
  description: DESCRIPTION,
  parameters: z.object({
    reason: z.string().describe("Brief explanation of why you're ready to switch to build mode"),
  }),
  async execute(params, ctx) {
    const approved = await ModeSwitch.ask({
      sessionID: ctx.sessionID,
      targetMode: "build",
      reason: params.reason,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    if (!approved) {
      throw new ModeSwitch.RejectedError()
    }

    return {
      title: "Mode switch approved",
      output:
        "The user has approved switching to build mode. You are now in build mode and can begin implementing the planned changes. Proceed with the implementation.",
      metadata: {
        approved: true,
        targetMode: "build",
      },
    }
  },
})
