import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

const parseIfString = (val: unknown) => {
  if (typeof val === "string") {
    try {
      return JSON.parse(val)
    } catch {
      return val
    }
  }
  return val
}

export const QuestionTool = Tool.define("question", {
  description: DESCRIPTION,
  parameters: z.object({
    questions: z.preprocess(parseIfString, z.array(Question.Info.omit({ custom: true }))).describe("Questions to ask"),
  }),
  formatValidationError(error: z.ZodError) {
    const err = error as any
    const questionsError = err.errors.find((e: any) => e.path[0] === "questions" && e.code === "invalid_type")
    if (questionsError && questionsError.message.includes("expected array, received string")) {
      return `The question tool received stringified JSON instead of a proper array. Please provide the questions parameter as a JSON array, not as a string. Example: {"questions": [{"question": "What approach?", "header": "Approach", "options": [{"label": "Option A", "description": "Description A"}]}]}`
    }

    const messages = err.errors.map((e: any) => {
      if (e.path.length === 0 && e.code === "invalid_type") {
        return "The tool arguments must be a JSON object with a 'questions' property"
      }
      if (e.path[0] === "questions" && e.code === "invalid_type") {
        return "The 'questions' parameter must be an array of question objects"
      }
      if (e.path[1] !== undefined && typeof e.path[1] === "number") {
        const field = e.path[2]
        const index = e.path[1]
        return `Question at index ${index}: ${field} ${e.message}`
      }
      return `${e.path.join(".")}: ${e.message}`
    })

    return messages.join("; ")
  },
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
