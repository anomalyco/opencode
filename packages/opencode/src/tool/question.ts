import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import { PermissionNext } from "../permission/next"
import DESCRIPTION from "./question.txt"

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.array(Question.Info.omit({ custom: true })).describe("Questions to ask"),
  }),
  async execute(params, ctx) {
    try {
      await ctx.ask({ permission: "question", patterns: ["*"], metadata: {}, always: ["*"] })
    } catch (e) {
      if (
        e instanceof PermissionNext.DeniedError ||
        e instanceof PermissionNext.RejectedError ||
        e instanceof PermissionNext.CorrectedError
      ) {
        return {
          title: "Question denied",
          output: "Cannot ask questions in this session. Make your best judgment and proceed.",
          metadata: { answers: [] },
        }
      }
      throw e
    }

    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: params.questions,
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })

    function format(answer: Question.Answer | undefined) {
      if (!answer?.length) return "Unanswered"
      return answer.join(", ")
    }

    const formatted = params.questions.map((q, i) => `"${q.question}"="${format(answers[i])}"`).join(", ")

    return {
      title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: {
        answers,
      },
    }
  },
})
