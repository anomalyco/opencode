import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./ask.txt"

export const AskTool = Tool.define("ask", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z
      .array(
        z.object({
          id: z.string().describe("Unique identifier for this question"),
          type: z.enum(["select", "multi-select", "confirm", "text"]).describe("The type of question"),
          question: z.string().describe("The question to ask the user"),
          options: z
            .array(
              z.object({
                value: z.string().describe("The value returned when this option is selected"),
                label: z.string().describe("The label shown to the user"),
                recommended: z.boolean().optional().describe("Mark this as the recommended option"),
              }),
            )
            .optional()
            .describe("Options for select/multi-select types"),
          default: z
            .union([z.string(), z.array(z.string()), z.boolean()])
            .optional()
            .describe("Default value shown as hint (not pre-selected)"),
        }),
      )
      .min(1)
      .describe("The questions to ask"),
  }),
  async execute(params, ctx) {
    ctx.metadata({
      title: `Asking ${params.questions.length} question${params.questions.length !== 1 ? "s" : ""}...`,
      metadata: {
        questions: params.questions,
        answers: {},
      },
    })

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      callID: ctx.callID,
      questions: params.questions,
    })

    return {
      title: `Asked ${params.questions.length} question${params.questions.length !== 1 ? "s" : ""}`,
      metadata: {
        questions: params.questions,
        answers,
      },
      output: JSON.stringify(answers, null, 2),
    }
  },
})
