import z from "zod"
import { Effect } from "effect"
import { Tool } from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

const parameters = z.object({
  questions: z.array(Question.Info.omit({ custom: true })).describe("Questions to ask"),
})

type Metadata = {
  answers: Question.Answer[]
}

export const QuestionTool = Tool.defineEffect<typeof parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters,
      async execute(params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) {
        const answers = await question
          .ask({
            sessionID: ctx.sessionID,
            questions: params.questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })
          .pipe(Effect.runPromise)

        const formatted = params.questions
          .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
          .join(", ")

        return {
          title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
          output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
          metadata: {
            answers,
          },
        }
      },
    } satisfies Tool.Def<typeof parameters, Metadata>
  }),
)
