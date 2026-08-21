import { ToolFailure } from "@opencode-ai/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { Tools } from "../tool/tools"
import { Tool } from "../tool/tool"
import * as Memory from "./index"

export * as MemoryTools from "./tools"

const listName = "memory_list"
const ListInput = Schema.Struct({})
const ListOutput = Schema.Struct({
  memories: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      content: Schema.String,
      source: Schema.String,
    }),
  ),
})

const deleteName = "memory_delete"
const DeleteInput = Schema.Struct({
  id: Memory.MemorySchema.ID.annotate({ description: "The ID of the memory to delete" }),
})
const DeleteOutput = Schema.Struct({
  success: Schema.Boolean,
})

const addName = "memory_add"
const AddInput = Schema.Struct({
  content: Schema.String.annotate({ description: "The content of the new memory to store" }),
})
const AddOutput = Schema.Struct({
  id: Schema.String,
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const memory = yield* Memory.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [listName]: Tool.make({
          description: "List all persistent memories stored for the current project.",
          input: ListInput,
          output: ListOutput,
          toModelOutput: ({ output }) => [{ type: "text", text: JSON.stringify(output.memories, null, 2) }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: listName,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const memories = yield* memory.list()
              return { memories: memories.map((m) => ({ id: m.id, content: m.content, source: m.source })) }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to list memories" }))),
        }),

        [deleteName]: Tool.make({
          description: "Delete a specific persistent memory by its ID.",
          input: DeleteInput,
          output: DeleteOutput,
          toModelOutput: ({ output }) => [{ type: "text", text: output.success ? "Memory deleted" : "Memory not found" }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: deleteName,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const success = yield* memory.delete(input.id)
              return { success }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to delete memory" }))),
        }),

        [addName]: Tool.make({
          description: "Add a new persistent memory for the current project. Use this when you learn something that should be remembered across sessions.",
          input: AddInput,
          output: AddOutput,
          toModelOutput: ({ output }) => [{ type: "text", text: `Memory stored with ID: ${output.id}` }],
          execute: (input, context) =>
            Effect.gen(function* () {
              yield* permission.assert({
                action: addName,
                resources: ["*"],
                save: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              const id = yield* memory.store(input.content, "manual", context.sessionID)
              return { id }
            }).pipe(Effect.mapError(() => new ToolFailure({ message: "Unable to add memory" }))),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "memory-tools",
  layer,
  deps: [Tools.node, Memory.node, PermissionV2.node],
})
