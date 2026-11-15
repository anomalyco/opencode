export * as QuestionTool from "./question.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import { ToolFailure } from "@opencode/ai/effect"
import { Effect, Schema } from "effect"
import { Form } from "../../form.js"
import { Permission } from "../../permission.js"
import { Question } from "@opencode/schema/question"
import { QuestionContinuation } from "@opencode/schema/question-continuation"
import { Tool } from "@opencode/schema/tool"
import { decodeInput, finalizeOutput } from "../runtime.js"

export const name = "question"

export const description = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- A "Type your own answer" option is added automatically; don't include a separate option for free form answers
- Set \`multiple: true\` to allow selecting more than one option
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`

export const Input = QuestionContinuation.Input
export const Prepared = QuestionContinuation.Prepared

export const Output = Schema.Struct({
  answers: Schema.Array(Question.Answer),
})
export type Output = typeof Output.Type

export class CancelledError extends Schema.TaggedError<CancelledError>()("QuestionTool.CancelledError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export const toModelContent = (questions: ReadonlyArray<Question.Prompt>, answers: ReadonlyArray<Question.Answer>) => {
  const formatted = questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

const finalize = (input: typeof Input.Type, state: Form.TerminalState) => {
  // Deliberate defect tunnel (see Permission.assert): a dismissal must dodge
  // leaf `mapError` blankets so it never becomes model-facing tool output; it
  // resurfaces as a typed failure at SessionModelRequest.executeTool.
  // A dismissal with a message is ordinary model-facing feedback.
  if (state.status === "cancelled" && state.message !== undefined)
    return Effect.fail(new ToolFailure({ message: state.message }))
  if (state.status === "cancelled") return Effect.die(new CancelledError())
  const output = {
    answers: input.questions.map((_, index): Question.Answer => {
      const value = state.answer[`q${index}`]
      if (value === undefined) return []
      if (Array.isArray(value)) return Array.from(value)
      return [String(value)]
    }),
  }
  return Effect.succeed({
    output,
    content: toModelContent(input.questions, output.answers),
    metadata: { answers: output.answers },
  })
}

const continuation = Symbol("question continuation")
const capability = Object.freeze({ adapter: "question@1" as const, finalize })
export type Prepared = typeof Prepared.Encoded

/** Gate 1 only: capture decoded, post-before-hook input without running the tool. */
export const prepare = (tool: Tool.Info, input: unknown) =>
  Effect.gen(function* () {
    const marked = Object.getOwnPropertyDescriptor(tool.execute, continuation)?.value
    if (
      marked?.capability !== capability ||
      marked?.executor !== tool.execute ||
      tool.name !== name ||
      tool.input !== Input ||
      tool.output !== Output ||
      tool.options?.namespace !== undefined ||
      tool.options?.codemode !== false
    )
      return yield* new Tool.Error({ message: "Tool is not eligible for question@1 continuation" })
    const decoded = yield* decodeInput(tool, input)
    const encoded = yield* Schema.encodeUnknownEffect(Input)(decoded).pipe(
      Effect.mapError((error) => new Tool.Error({ message: error.message })),
    )
    return { adapter: capability.adapter, input: encoded }
  })

/** Repeatable terminal finalization; never re-enters an executor or Location service. */
export const restore = (envelope: unknown, terminal: unknown) =>
  Effect.gen(function* () {
    // The literal resolves exactly one version. There is deliberately no fallback.
    const prepared = yield* Schema.decodeUnknownEffect(Prepared)(envelope).pipe(
      Effect.mapError((error) => new Tool.Error({ message: `Invalid Question continuation: ${error.message}` })),
    )
    const state = yield* Schema.decodeUnknownEffect(Form.State)(terminal).pipe(
      Effect.mapError((error) => new Tool.Error({ message: `Invalid Question terminal state: ${error.message}` })),
    )
    if (state.status === "pending")
      return yield* new Tool.Error({ message: "Question continuation requires a terminal Form state" })
    const result = yield* capability.finalize(prepared.input, state)
    return yield* finalizeOutput({ output: Output }, result)
  })

export const Plugin = {
  id: "opencode.tool.question",
  effect: Effect.fn("QuestionTool.Plugin")(function* (ctx: Context) {
    const forms = yield* Form.Service
    const permission = yield* Permission.Service

    const execute = (input: typeof Input.Type, context: Tool.Context) =>
      permission
        .assert({
          action: "question",
          resources: ["*"],
          ...Permission.invocation(context),
        })
        .pipe(
          Effect.mapError((error) => new ToolFailure({ message: "Permission denied: question", error })),
          Effect.andThen(
            forms
              .ask({
                sessionID: context.sessionID,
                title: "Questions",
                metadata: {
                  kind: "question",
                  tool: { messageID: context.messageID, id: context.id },
                },
                fields: [
                  toField(input.questions[0], 0),
                  ...input.questions.slice(1).map((question, index) => toField(question, index + 1)),
                ],
              })
              .pipe(Effect.orDie),
          ),
          Effect.flatMap((state) => finalize(input, state)),
        )
    // Keep the original identity even if a wrapper copies the function's properties.
    Object.defineProperty(execute, continuation, { value: Object.freeze({ capability, executor: execute }) })

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute,
        }),
      )
      .pipe(Effect.orDie)
  }),
}

function toField(question: Question.Prompt, index: number): Form.Field {
  return {
    key: `q${index}`,
    title: question.header,
    description: question.question,
    type: question.multiple === true ? "multiselect" : "string",
    options: question.options.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description,
    })),
    custom: true,
  }
}
