import { Effect, Schema } from "effect"
import * as Tool from "../../tool/tool"
import { MemoryStore } from "../memory-store"
import DESCRIPTION from "./remember.txt"

export const Parameters = Schema.Struct({
  title: Schema.String,
  content: Schema.String,
  type: Schema.optional(Schema.Literals(["episodic", "semantic", "procedural", "pattern"])),
  tags: Schema.optional(Schema.Array(Schema.String)),
  importance: Schema.optional(Schema.Number),
})

type Metadata = {
  id: string
  type: string
}

export const RememberTool = Tool.define<typeof Parameters, Metadata, MemoryStore.Service>(
  "remember",
  Effect.gen(function* () {
    const memory = yield* MemoryStore.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const id = yield* memory.store({
            sessionID: ctx.sessionID,
            title: params.title,
            content: params.content,
            type: params.type,
            tags: params.tags ? [...params.tags] : [],
            importance: params.importance,
          })
          return {
            title: `Remembered: ${params.title}`,
            output: `Stored "${params.title}" as ${params.type ?? "semantic"} memory (ID: ${id}).`,
            metadata: { id, type: params.type ?? "semantic" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)