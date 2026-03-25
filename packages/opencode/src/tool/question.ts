import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

const OptionSchema = z.object({
  label: z.string().describe("Display text (1-5 words, concise)"),
  description: z.string().describe("Explanation of choice"),
})

const QuestionInfoSchema = z.object({
  question: z.string().describe("Complete question"),
  header: z.string().describe("Very short label (max 30 chars)"),
  options: z.array(OptionSchema).describe("Available choices"),
  multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
})

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.array(QuestionInfoSchema).describe("Questions to ask"),
  }),
  async execute(params, ctx) {
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
