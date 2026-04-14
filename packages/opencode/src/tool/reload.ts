import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { ConfigReload } from "@/config/reload"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceStore } from "@/project/instance-store"

export const Parameters = Schema.Struct({})

export const ReloadTool = Tool.define(
  "reload_config",
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const store = yield* InstanceStore.Service
    const reload = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(EventV2Bridge.Service, events), Effect.provideService(InstanceStore.Service, store))

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

          const result = yield* ConfigReload.request({ resumeSessionID: ctx.sessionID })

          return {
            title: result.immediate ? "Configuration reload started" : "Configuration reload queued",
            output: result.immediate
              ? "Reload started. The session will stop now and resume automatically after reload."
              : "Reload queued. The session will stop now and resume automatically after reload.",
            metadata: { queued: !result.immediate },
            stopSession: true,
          }
        }).pipe(reload),
    }
  }),
)
