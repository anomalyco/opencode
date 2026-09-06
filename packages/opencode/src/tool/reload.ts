import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { ConfigReload } from "@/config/reload"

export const Parameters = Schema.Struct({})

export const ReloadTool = Tool.define(
  "reload_config",
  Effect.gen(function* () {
    const reload = yield* ConfigReload.Service

    return {
      description: "Reload OpenCode configuration files and plugins without restarting.",
      parameters: Parameters,
      execute: (_params, ctx) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "reload_config",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const result = yield* reload.request(ctx.sessionID)

          return {
            title: result.immediate ? "Configuration reload started" : "Configuration reload queued",
            output: result.immediate
              ? "Reload started. Wait for the reload to finish before continuing."
              : "Reload will start after active sessions finish.",
            metadata: { queued: !result.immediate },
            stopAfterToolResult: true,
          }
        }),
    }
  }),
)
