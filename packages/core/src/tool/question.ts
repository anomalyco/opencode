export * as QuestionTool from "./question"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { optional } from "@opencode-ai/schema/schema"
import { Form } from "../form"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "question"

export const description = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- When \`custom\` is enabled (default), a "Type your own answer" option is added automatically; don't include "Other" or catch-all options
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`

export const Option = Schema.Struct({
  label: Schema.String.annotate({ description: "Display text (1-5 words, concise)" }),
  description: Schema.String.annotate({ description: "Explanation of choice" }),
}).annotate({ identifier: "QuestionTool.Option" })
export interface Option extends Schema.Schema.Type<typeof Option> {}

export const Prompt = Schema.Struct({
  question: Schema.String.annotate({ description: "Complete question" }),
  header: Schema.String.annotate({ description: "Very short label (max 30 chars)" }),
  options: Schema.Array(Option).annotate({ description: "Available choices" }),
  multiple: Schema.Boolean.pipe(optional).annotate({ description: "Allow selecting multiple choices" }),
  custom: Schema.Boolean.pipe(optional).annotate({ description: "Allow typing a custom answer (default: true)" }),
}).annotate({ identifier: "QuestionTool.Prompt" })
export interface Prompt extends Schema.Schema.Type<typeof Prompt> {}

export const Answer = Schema.Array(Schema.String).annotate({ identifier: "QuestionTool.Answer" })
export type Answer = typeof Answer.Type

export const Input = Schema.Struct({
  questions: Schema.Array(Prompt).annotate({ description: "Questions to ask" }),
})

export const Output = Schema.Struct({
  answers: Schema.Array(Answer),
})
export type Output = typeof Output.Type

export class RejectedError extends Error {
  constructor() {
    super("The user dismissed this question")
  }
}

export const toModelOutput = (questions: ReadonlyArray<Prompt>, answers: ReadonlyArray<Answer>) => {
  const formatted = questions
    .map(
      (question, index) =>
        `"${question.question}"="${answers[index]?.length ? answers[index].join(", ") : "Unanswered"}"`,
    )
    .join(", ")
  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const form = yield* Form.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ input, output }) => [
            { type: "text", text: toModelOutput(input.questions, output.answers) },
          ],
          execute: (input, context) =>
            permission
              .assert({
                action: "question",
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              .pipe(
                Effect.mapError(() => new ToolFailure({ message: "Permission denied: question" })),
                Effect.andThen(
                  form
                    .ask({
                      sessionID: context.sessionID,
                      title: input.questions.length === 1 ? input.questions[0]?.header : "Questions",
                      metadata: {
                        kind: "question",
                        tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                      },
                      mode: "form",
                      fields: input.questions.map(questionToField),
                    })
                    .pipe(Effect.orDie),
                ),
                Effect.flatMap((state) =>
                  state.status === "answered" ? Effect.succeed({ answers: formToAnswers(input.questions, state.answer) }) : Effect.die(new RejectedError()),
                ),
              ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/question",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, Form.node],
})

function questionToField(question: Prompt, index: number): Form.Field {
  const base = {
    key: key(index),
    title: question.question,
    description: question.header,
  }
  const options = question.options.map((option) => ({
    value: option.label,
    label: option.label,
    description: option.description,
  }))
  if (question.multiple) return { ...base, type: "multiselect", options, custom: question.custom ?? true }
  return { ...base, type: "string", options, custom: question.custom ?? true }
}

function formToAnswers(questions: ReadonlyArray<Prompt>, answer: Form.Answer): ReadonlyArray<Answer> {
  return questions.map((_, index) => {
    const value = answer[key(index)]
    if (Array.isArray(value)) return value
    if (typeof value === "string" && value.length > 0) return [value]
    return []
  })
}

function key(index: number) {
  return `question_${index}`
}
