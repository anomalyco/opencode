export * as PluginPtyEnvironment from "./pty-environment"

import { PtyEnvironment } from "@opencode-ai/server/pty-environment"
import { Effect, Layer } from "effect"
import { InstanceStore } from "@/project/instance-store"
import { Plugin } from "."

export const layer = Layer.effect(
  PtyEnvironment.Service,
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const instances = yield* InstanceStore.Service
    return PtyEnvironment.Service.of({
      get: Effect.fn("PtyEnvironment.get")(function* (input) {
        return yield* instances.provide(
          { directory: input.directory },
          plugin
            .trigger("shell.env", { cwd: input.cwd }, { env: {} as Record<string, string> })
            .pipe(Effect.map((result) => result.env)),
        )
      }),
    })
  }),
)
