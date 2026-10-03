import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { SessionAgentSwitch } from "@/session/agent-switch"
import { Provider } from "@/provider/provider"
import DESCRIPTION from "./question.txt"

export const Parameters = Schema.Struct({
  questions: Schema.mutable(Schema.Array(Question.Prompt)).annotate({ description: "Questions to ask" }),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
}

export const QuestionTool = Tool.define<
  typeof Parameters,
  Metadata,
  Question.Service | Session.Service | Provider.Service
>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service
    const session = yield* Session.Service
    const provider = yield* Provider.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const resolution = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: params.questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })
          const answers = resolution.answers

          const info = yield* session.get(ctx.sessionID)
          const target =
            resolution.agent && !info.parentID && resolution.agent !== ctx.agent ? resolution.agent : undefined
          if (target)
            yield* SessionAgentSwitch.switchAgent({
              session,
              provider,
              sessionID: ctx.sessionID,
              agent: target,
              text: `The user answered the questions and chose to continue in the ${target} agent. Continue with the implementation.`,
            })

          const formatted = params.questions
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")

          return {
            title: target
              ? `Switching to ${target} agent`
              : `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: target
              ? `User has answered your questions: ${formatted}. They chose to continue in the ${target} agent. Stop here and wait for further instructions.`
              : `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
            metadata: {
              answers,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
