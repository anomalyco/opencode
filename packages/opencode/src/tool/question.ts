import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.array(Question.Info).describe("Questions to ask"),
  }),
  async execute(params, ctx) {
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    const formatted = params.questions.map((q, i) => `"${q.question}"="${answers[i] ?? "Unanswered"}"`).join(", ")

    return {
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: {
        answers,
      },
    }
  },
})
