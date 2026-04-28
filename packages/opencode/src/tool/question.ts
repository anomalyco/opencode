import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

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

const parameters = z.object({
  questions: z.preprocess(normalizeQuestionsInput, z.array(Question.Prompt.zod)).describe("Questions to ask"),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
}

export const QuestionTool = Tool.define<typeof parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters,
      formatValidationError(error: z.ZodError) {
        return [
          `The question tool was called with invalid arguments: ${error}.`,
          "Pass `questions` as an array of question objects, not a JSON-encoded string.",
          'Example: {"questions":[{"header":"Stack","question":"Which language?","options":[]}]}',
        ].join("\n")
      },
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
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
