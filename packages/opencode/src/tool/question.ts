import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"
import PLAN_DESCRIPTION from "./plan-question.txt"

export const Parameters = Schema.Struct({
  questions: Schema.mutable(Schema.Array(Question.Prompt)).annotate({ description: "Questions to ask" }),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
}

function defineQuestionTool<ID extends string>(
  id: ID,
  description: string,
  output: (formatted: string) => string,
) {
  return Tool.define<typeof Parameters, Metadata, Question.Service, ID>(
    id,
    Effect.gen(function* () {
      const question = yield* Question.Service

      return {
        description,
        parameters: Parameters,
        execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
          Effect.gen(function* () {
            const answers = yield* question.ask({
              sessionID: ctx.sessionID,
              questions: params.questions,
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })

            const formatted = params.questions
              .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
              .join(", ")

            return {
              title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
              output: output(formatted),
              metadata: {
                answers,
              },
            }
          }).pipe(Effect.orDie),
      }
    }),
  )
}

export const QuestionTool = defineQuestionTool(
  "question",
  DESCRIPTION,
  (formatted) => `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
)

export const PlanQuestionTool = defineQuestionTool(
  "plan_question",
  PLAN_DESCRIPTION,
  (formatted) =>
    `User has answered your plan-mode questions: ${formatted}. Continue refining the plan with these answers. When no open questions remain, finalize and submit the plan.`,
)
