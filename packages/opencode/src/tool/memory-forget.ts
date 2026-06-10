import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Memory } from "@/memory/memory"

export const Parameters = Schema.Struct({
  id: Schema.String.annotate({
    description: "The ID of the memory to delete. Get this from memory_search results.",
  }),
})

export const MemoryForgetTool = Tool.define<typeof Parameters, {}, Memory.Service>(
  "memory_forget",
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      description:
        "Delete a stored long-term memory by its ID. Use this to remove outdated, incorrect, or no longer relevant memories.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          yield* memory.forget(params.id)

          return {
            title: "Memory forgotten",
            output: `Forgot memory ${params.id}`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
