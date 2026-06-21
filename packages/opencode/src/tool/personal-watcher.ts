import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Watcher } from "@opencode-ai/core/personal/watcher"
import DESCRIPTION from "./personal-watcher.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("list", "create", "delete", "check"),
  name: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  condition: Schema.optional(Schema.String),
  watcher_id: Schema.optional(Schema.String),
})

export const PersonalWatcherTool = Tool.define(
  "personal_watcher",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const svc = yield* Watcher
          switch (params.action) {
            case "list": {
              const watchers = yield* svc.list
              return {
                title: "Watchers",
                output: watchers.length > 0 ? JSON.stringify(watchers, null, 2) : "No watchers registered.",
              }
            }
            case "create": {
              if (!params.name || !params.type || !params.target)
                return yield* Effect.fail(new Error("name, type, and target are required for create action"))
              const w = yield* svc.create(params.name, params.type, params.target, params.condition)
              return { title: "Watcher criado", output: JSON.stringify(w, null, 2) }
            }
            case "delete": {
              if (!params.watcher_id)
                return yield* Effect.fail(new Error("watcher_id is required for delete action"))
              yield* svc.delete(params.watcher_id)
              return { title: "Watcher removido", output: `Watcher ${params.watcher_id} deleted.` }
            }
            case "check": {
              yield* svc.checkAll
              return { title: "Watchers verificados", output: "All watchers checked." }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
