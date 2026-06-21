export * as MemoryTool from "./memory"

import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { PermissionV2 } from "../permission"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { Service as MemoryService } from "../memory/service"

export const rememberName = "zero_remember"
export const recallName = "zero_recall"

export const RememberInput = Schema.Struct({
  fact: Schema.String.annotate({ description: "The fact, preference, or rule to remember about the user or project" }),
})

export const RememberOutput = Schema.Struct({
  success: Schema.Boolean,
})

export const RecallInput = Schema.Struct({
  query: Schema.String.annotate({ description: "Search query to retrieve relevant memories from long-term memory" }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max number of memories to retrieve (default: 5)" }),
})

export const RecallOutput = Schema.Struct({
  memories: Schema.Array(Schema.String),
})

export const rememberLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const memory = yield* MemoryService
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [rememberName]: Tool.make({
          description: "Save a fact, preference, or instruction to your long-term memory so it persists across sessions.",
          input: RememberInput,
          output: RememberOutput,
          toModelOutput: ({ output }) => [{ type: "text", text: output.success ? "Fato lembrado com sucesso." : "Falha ao salvar fato." }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: rememberName,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              yield* memory.remember(input.fact)
              return { success: true }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to save memory" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const recallLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const memory = yield* MemoryService
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [recallName]: Tool.make({
          description: "Recall relevant past memories, facts, or instructions based on a search query.",
          input: RecallInput,
          output: RecallOutput,
          toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output.memories, null, 2) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: recallName,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const results = yield* memory.recall(input.query, input.limit ?? 5)
              return { memories: results.map((r) => r.content) }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to recall memories" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const layer = Layer.merge(rememberLayer, recallLayer)
