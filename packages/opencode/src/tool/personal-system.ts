import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-system.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("info", "notify"),
  title: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
})

export const PersonalSystemTool = Tool.define(
  "personal_system",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { System } = yield* Effect.promise(() => import("@opencode-ai/core/personal/system"))
          const svc = yield* System

          switch (params.action) {
            case "info": {
              const info = yield* svc.getInfo()
              return {
                title: "Informações do sistema",
                output: Object.entries(info)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n"),
              }
            }
            case "notify": {
              if (!params.title || !params.message)
                return yield* Effect.fail(new Error("title and message are required for notify action"))
              yield* svc.notify(params.title, params.message)
              return { title: "Notificação enviada", output: `Notification sent: ${params.title}` }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
