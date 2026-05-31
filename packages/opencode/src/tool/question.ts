import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"
import type { MessageV2 } from "../session/message-v2"

function extractBase64(url: string): string {
  const comma = url.indexOf(",")
  if (comma === -1) return url
  const body = url.slice(comma + 1)
  if (!body.startsWith("data:")) return body
  return extractBase64(body)
}

function dataUrl(url: string, mime: string) {
  if (!url.startsWith("data:")) return `data:${mime};base64,${url}`
  return `data:${mime};base64,${extractBase64(url)}`
}

function format(part: Question.Part) {
  if (typeof part === "string") return part
  return part.filename ? `[image: ${part.filename}]` : "[image]"
}

function file(part: Question.Part): Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID"> | undefined {
  if (typeof part === "string") return undefined
  return {
    type: "file",
    mime: part.mime,
    url: dataUrl(part.url, part.mime),
    filename: part.filename,
  }
}

export const Parameters = Schema.Struct({
  questions: Schema.mutable(Schema.Array(Question.Prompt)).annotate({ description: "Questions to ask" }),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
}

export const QuestionTool = Tool.define<typeof Parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const answers = yield* question.ask({
            sessionID: ctx.sessionID,
            questions: params.questions,
            tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
          })

          const formatted = params.questions
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].map(format).join(", ") : "Unanswered"}"`)
            .join(", ")
          const attachments = answers.flatMap((answer) =>
            answer.flatMap((part) => {
              const next = file(part)
              return next ? [next] : []
            }),
          )

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
            metadata: {
              answers,
            },
            attachments,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
