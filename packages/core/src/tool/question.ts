export * as QuestionTool from "./question"

import { Tool, toolText } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { QuestionV2 } from "../question"
import { ToolRegistry } from "./registry"

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

export const Parameters = Schema.Struct({
  questions: Schema.Array(QuestionV2.Prompt).annotate({ description: "Questions to ask" }),
})

export const Success = Schema.Struct({
  answers: Schema.Array(QuestionV2.Answer),
})
export type Success = typeof Success.Type

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

const definition = Tool.make({
  description,
  parameters: Parameters,
  success: Success,
  toModelOutput: ({ parameters, output }) => [
    toolText({ type: "text", text: toModelOutput(parameters.questions, output.answers) }),
  ],
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const question = yield* QuestionV2.Service

    yield* registry.contribute((editor) =>
      editor.set(name, {
        tool: definition,
        execute: ({ parameters, sessionID, source }) =>
          question
            .ask({
              sessionID,
              questions: parameters.questions,
              // The registry intentionally leaves source absent until it owns the durable assistant message ID.
              tool: source?.type === "tool" ? { messageID: source.messageID, callID: source.callID } : undefined,
            })
            .pipe(
              Effect.map((answers) => ({ answers })),
              // V1 treats a dismissed question as an interrupted tool invocation rather than model-facing text.
              Effect.orDie,
            ),
      }),
    )
  }),
)
