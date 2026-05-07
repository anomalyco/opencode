import { Effect, Schema, SchemaGetter } from "effect"
import { ZodOverride, zod } from "@/util/effect-zod"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"

// normalizeQuestionsInput: Qwen 系モデルが `questions` を malformed JSON string や
// 単一オブジェクトとして送ってくる issue (#21 / #67 / #100) を吸収するため、生 input を
// 「question 配列形式」へ正規化する。schema 側 (Parameters) では Schema.Unknown を
// from に置いた decodeTo で本関数を呼び、Array(Question.Prompt) へ変換する。
// JSON Schema (LLM 提示用) は ZodOverride で正規 array 形式のみを露出させ、
// LLM への期待値は "array" のままに保つ。

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

const QuestionsArray = Schema.mutable(Schema.Array(Question.Prompt))

// Schema.Unknown を from に置くことで、stringified JSON / 単一オブジェクト /
// bare string などが届いても decodeTo の decode で先に正規化される。
// JSON Schema 側は ZodOverride で正規 array 形式のみを emit するので、
// LLM への期待値は arr のままに保つ (#21 の z.preprocess と同等の挙動)。
// normalize の戻り値は配列でない場合 (input が完全な garbage の場合) もあるが、
// その場合は to schema の validation で reject されて formatValidationError 経由で
// LLM にヒントが返る。ここの cast は runtime ではなく Effect Schema の Getter 型に
// 「decode は To["Encoded"] を返す」と宣言するための型レベルの調整。
const QuestionsField = Schema.Unknown.pipe(
  Schema.decodeTo(QuestionsArray, {
    decode: SchemaGetter.transform(
      (input) => normalizeQuestionsInput(input) as (typeof QuestionsArray)["Encoded"],
    ),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
).annotate({
  description: "Questions to ask",
  [ZodOverride]: zod(QuestionsArray),
})

export const Parameters = Schema.Struct({
  questions: QuestionsField,
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
}

// formatValidationError: preprocess (normalizeQuestionsInput) で吸収しきれなかった
// schema 違反を LLM に説明する。Effect Schema の decode error メッセージは
// 構造化されているがそのまま見せると model が path を写経して再失敗するため、
// canonical な array 形式と `options` 省略可ルールを明示する短いヒントへ置換する。
function formatValidationError(error: unknown): string {
  const detail = String(error).slice(0, 240)
  return [
    `The "questions" parameter must be a JSON array of question objects.`,
    `Canonical shape:`,
    `  [{"question": "...", "header": "...", "options": [{"label": "...", "description": "..."}]}]`,
    `Common mistakes:`,
    `  - Wrapping the array in quotes (send the array itself, not a JSON-encoded string).`,
    `  - Sending a single question object instead of an array (wrap it in []).`,
    `  - Including stray newlines or whitespace around the array.`,
    `If a question has no preset choices, omit the "options" field (or pass []) ` +
      `and the user will be prompted for free-form input.`,
    `Decoder said: ${detail}`,
  ].join("\n")
}

export const QuestionTool = Tool.define<typeof Parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      formatValidationError,
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
