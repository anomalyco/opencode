import z from "zod"
import { Tool } from "./tool"

const DESCRIPTION = `Submit your implementation plan for user approval and transition out of planning phase.

Call this tool after you have:
1. Explored the relevant code and understood the problem
2. Identified the files that need changes
3. Determined your implementation approach

The plan should be actionable - include specific files, functions, and steps. Keep it concise but complete.

Note: User instructions with future-tense phrasing like "remember to..." or "make sure you..." or "before you start..." are requirements to capture in your plan, not immediate actions. Include them as steps in your plan.
`

export const ExitPlanModeTool = Tool.define("exitplanmode", {
  description: DESCRIPTION,
  parameters: z.object({
    plan: z
      .string()
      .describe("Your implementation plan in markdown format. Include files to modify, approach, and steps."),
  }),
  async execute(params, _opts) {
    return {
      title: "Plan submitted for approval",
      output: params.plan,
      metadata: {
        plan: params.plan,
        exitPlanMode: true,
      },
    }
  },
})
