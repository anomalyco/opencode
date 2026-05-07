import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

// normalizeQuestionsInput: Qwen が `questions` を malformed JSON string として送る issue (#67/#69)
// で、生 input を可能な限り「question 配列形式」へ正規化する。
//
// 元 catch-up sprint では `z.preprocess` で schema レベルに組み込んでいたが、v1.14.x で
// schema が Effect Schema に移行したため、preprocess を schema に組み込むのは別途 refactor が
// 必要 (Schema.transform)。当面は **processor.ts の state 記録時のみ** にこの関数を使い、
// execute() に届く時点では upstream の strict decode を許容する (LLM 側に正しい形式を強制)。
// schema preprocess の再導入は #90 のフォロー作業として継続。

function trim(input: unknown) {
  return typeof input === "string" ? input.trim() : ""
}

function head(input: string) {
  const value = input.split("\n")[0]?.trim() ?? ""
  if (!value) return "Question"
  if (value.length <= 30) return value
  return value.slice(0, 27).trimEnd() + "..."
}

function parse(input: string) {
  try {
    return JSON.parse(input)
  } catch {
    return undefined
  }
}

function option(input: unknown) {
  if (typeof input === "string") {
    const value = input.trim()
    if (!value) return undefined
    return {
      label: value,
      description: value,
    }
  }
  if (!input || typeof input !== "object") return undefined
  const label = trim((input as Record<string, unknown>).label)
  if (!label) return undefined
  return {
    label,
    description: trim((input as Record<string, unknown>).description) || label,
  }
}

function info(input: unknown) {
  if (typeof input === "string") {
    const value = input.trim()
    if (!value) return undefined
    const parsed = parse(value)
    if (parsed !== undefined) return info(parsed)
    return {
      question: value,
      header: head(value),
      options: [],
    }
  }
  if (!input || typeof input !== "object") return undefined
  const value = input as Record<string, unknown>
  const question = trim(value.question) || trim(value.header)
  if (!question) return undefined
  const options = Array.isArray(value.options) ? value.options.map(option).filter((x) => x !== undefined) : []
  return {
    question,
    header: trim(value.header) || head(question),
    options,
    ...(value.multiple === true ? { multiple: true } : {}),
  }
}

export function normalizeQuestionsInput(input: unknown) {
  if (typeof input === "string") {
    const value = input.trim()
    if (!value) return input
    const parsed = parse(value)
    if (parsed !== undefined) return normalizeQuestionsInput(parsed)
    const single = info(value)
    return single ? [single] : input
  }
  if (Array.isArray(input)) return input.map(info).filter((x) => x !== undefined)
  const single = info(input)
  if (single) return [single]
  return input
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
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
            metadata: {
              answers,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
