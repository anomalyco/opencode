export * as QuestionTool from "./question"

import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { ToolFailure } from "@opencode-ai/ai"
import { Effect, Schema } from "effect"
import { Form } from "../form"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { Tool } from "./tool"

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

export const Input = Schema.Struct({
  questions: Schema.NonEmptyArray(QuestionV2.Prompt).annotate({ description: "Questions to ask" }),
})

export const Output = Schema.Struct({
  answers: Schema.Array(QuestionV2.Answer),
})
export type Output = typeof Output.Type

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("QuestionTool.CancelledError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export const toModelOutput = (
  questions: ReadonlyArray<QuestionV2.Prompt>,
  answers: ReadonlyArray<QuestionV2.Answer>,
) => {
  const formatted = questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

export const Plugin = {
  id: "opencode.tool.question",
  effect: Effect.fn("QuestionTool.Plugin")(function* (ctx: PluginContext) {
    const forms = yield* Form.Service
    const permission = yield* PermissionV2.Service

    yield* ctx.tool
      .transform((draft) =>
        draft.add(
          name,
          Tool.make({
            description,
            input: Input,
            output: Output,
            execute: (input, context) =>
              permission
                .assert({
                  action: "question",
                  resources: ["*"],
                  sessionID: context.sessionID,
                  agent: context.agent,
                  source: { type: "tool", messageID: context.messageID, callID: context.callID },
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
                          tool: { messageID: context.messageID, callID: context.callID },
                        },
                        fields: [
                          toField(input.questions[0], 0),
                          ...input.questions.slice(1).map((question, index) => toField(question, index + 1)),
                        ],
                      })
                      .pipe(Effect.orDie),
                  ),
                  Effect.flatMap((state) => {
                    // Deliberate defect tunnel (see PermissionV2.assert): a dismissal must dodge
                    // leaf `mapError` blankets so it never becomes model-facing tool output; it
                    // resurfaces as a typed failure at SessionModelRequest.executeTool.
                    if (state.status === "cancelled") return Effect.die(new CancelledError())
                    const output = {
                      answers: input.questions.map((_, index): QuestionV2.Answer => {
                        const value = state.answer[`q${index}`]
                        if (value === undefined) return []
                        if (typeof value === "object") return Array.from(value)
                        return [String(value)]
                      }),
                    }
                    return Effect.succeed({
                      output,
                      content: toModelOutput(input.questions, output.answers),
                      metadata: { answers: output.answers },
                    })
                  }),
                ),
          }),
          { codemode: false },
        ),
      )
      .pipe(Effect.orDie)
  }),
}

function toField(question: QuestionV2.Prompt, index: number): Form.Field {
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
