export * as QuestionTool from "./question"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
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
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Previews:
Each option accepts an optional \`preview\`: a block of plain monospace text shown beside the option list as the user moves the selection. Use it when the choice is between concrete comparable artifacts that a one-line description cannot convey:
- competing layouts or UI mockups drawn as ASCII
- two implementations of the same function
- config, schema or API shape variants
- directory structures
Rules:
- Do NOT use \`preview\` for simple preference questions where \`label\` and \`description\` already say everything — an unnecessary preview pane is noise
- Previews are ignored when \`multiple\` is true, since no single option is focused
- Content is rendered verbatim in a fixed-width pane: no markdown, no HTML, no ANSI colors. Don't wrap it in a code fence
- Keep previews under 2000 characters and lines short; longer content is truncated
- Previews replace dumping the variants into your message text before asking — when you use one, don't repeat the same content in prose`

export const Input = Schema.Struct({
  questions: Schema.Array(QuestionV2.Prompt).annotate({ description: "Questions to ask" }),
})

export const Output = Schema.Struct({
  answers: Schema.Array(QuestionV2.Answer),
})
export type Output = typeof Output.Type

/**
 * Cleans model-supplied option previews once, at the boundary, so every surface
 * downstream receives display-ready text and none of them has to defend itself.
 */
export const sanitize = (questions: ReadonlyArray<QuestionV2.Prompt>): ReadonlyArray<QuestionV2.Prompt> =>
  questions.map((question) => {
    const options = QuestionV2.normalizeOptions(question.options, question.multiple)
    return options === question.options ? question : { ...question, options }
  })

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

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const question = yield* QuestionV2.Service
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
                  question
                    .ask({
                      sessionID: context.sessionID,
                      questions: sanitize(input.questions),
                      tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                    })
                    .pipe(Effect.orDie),
                ),
                Effect.map((answers) => ({ answers })),
              ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/question",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, QuestionV2.node],
})
