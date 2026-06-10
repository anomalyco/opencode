import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Memory } from "@/memory/memory"

export const Parameters = Schema.Struct({
  content: Schema.String.annotate({
    description: "The memory content to store. A concise factual statement about the user's preferences, project decisions, coding conventions, or important context that should be remembered across sessions.",
  }),
})

export const MemoryAddTool = Tool.define<typeof Parameters, {}, Memory.Service>(
  "memory_add",
  Effect.gen(function* () {
    const memory = yield* Memory.Service

    return {
      description:
        "Store a new long-term memory. Use this to remember important information about the user, their preferences, project conventions, decisions, or other context that should persist across sessions. The memory is stored with a vector embedding for semantic search later.",
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>) =>
        Effect.gen(function* () {
          const result = yield* memory.add({
            content: params.content,
          })

          return {
            title: "Memory stored",
            output: `Stored memory "${params.content.slice(0, 80)}${params.content.length > 80 ? "..." : ""}" (id: ${result.id})`,
            metadata: {},
          }
        }).pipe(Effect.orDie),
    }
  }),
)
