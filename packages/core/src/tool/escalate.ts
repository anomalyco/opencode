export * as EscalateTool from "./escalate"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { SessionExecution } from "../session/execution"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "escalate"

export const description = `Escalate the current task to a more capable model.

Use this tool when you determine that the current local/small model cannot adequately handle the task:
- Repeated failures or unclear reasoning
- Complex multi-file refactoring required
- Deep debugging beyond simple fixes
- Architecture decisions requiring broad context
- Any situation where you've tried but lack sufficient capability

The escalation will re-route the task to a cloud-based model (Anthropic, OpenAI, etc.) while preserving session context.

Once you call this tool, the task will be automatically re-queued with cloud routing. You do not need to take further action.`

export const Input = Schema.Struct({
  reason: Schema.String.annotate({
    description: "Brief explanation of why escalation is needed",
  }),
})

export const Output = Schema.Struct({
  escalated: Schema.Boolean,
  message: Schema.String,
})
export type Output = typeof Output.Type

export const toModelOutput = (output: Output) =>
  `Escalation ${output.escalated ? "queued" : "failed"}: ${output.message}`

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const execution = yield* SessionExecution.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: toModelOutput(output) }],
          execute: (input, context) =>
            execution
              .escalate({
                sessionID: context.sessionID,
                reason: input.reason,
              })
              .pipe(
                Effect.map(
                  (result): Output => ({
                    escalated: result.escalated,
                    message: result.message,
                  }),
                ),
                Effect.mapError(
                  (e): ToolFailure => new ToolFailure({ message: e.message }),
                ),
              ),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/escalate",
  layer,
  deps: [ToolRegistry.node, SessionExecution.node],
})
