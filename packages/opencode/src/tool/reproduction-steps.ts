import z from "zod"
import { Tool } from "./tool"
import { ReproductionSteps as ReproductionStepsNS } from "../debug/repro"
import DESCRIPTION from "./reproduction-steps.txt"

export const ReproductionSteps = Tool.define("reproduction_steps", {
  description: DESCRIPTION,
  parameters: z.object({
    steps: z.array(z.string()).min(1).describe("Numbered reproduction steps"),
  }),
  async execute(params, ctx) {
    const action = await ReproductionStepsNS.ask({
      sessionID: ctx.sessionID,
      steps: params.steps,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    return {
      title: "Debug reproduction",
      output: `User selected "${action}". Continue the debug workflow based on this action.`,
      metadata: {
        action,
      },
    }
  },
})
