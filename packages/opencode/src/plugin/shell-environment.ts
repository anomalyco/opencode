export * as PluginShellEnvironment from "./shell-environment"

import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { ShellEnvironment } from "@opencode-ai/core/shell-environment"
import { Effect, Layer } from "effect"
import { InstanceRef } from "@/effect/instance-ref"
import { Project } from "@/project/project"
import { Plugin } from "."

export const layer = Layer.effect(
  ShellEnvironment.Service,
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service
    const project = yield* Project.Service
    return ShellEnvironment.Service.of({
      get: Effect.fn("ShellEnvironment.get")(function* (input) {
        const result = yield* project.fromDirectory(input.directory)
        const instance = {
          directory: input.directory,
          worktree: result.sandbox,
          project: result.project,
        }
        return yield* plugin
          .trigger(
            "shell.env",
            { cwd: input.cwd, sessionID: input.sessionID, callID: input.callID },
            { env: {} as Record<string, string> },
          )
          .pipe(
            Effect.map((output) => output.env),
            Effect.provideService(InstanceRef, instance),
          )
      }),
    })
  }),
)

export const node = makeLocationNode({
  service: ShellEnvironment.Service,
  layer,
  deps: [Plugin.node, Project.node],
})
