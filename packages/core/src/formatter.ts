export * as Formatter from "./formatter"

import { Context, Effect, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import path from "path"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Npm } from "@opencode-ai/util/npm"
import { AppProcess } from "@opencode-ai/util/process"
import { Config } from "./config"
import { Location } from "./location"
import { make, type Info } from "./formatter/builtins"

export interface Interface {
  readonly file: (filepath: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Formatter") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const location = yield* Location.Service
    const npm = yield* Npm.Service
    const processes = yield* AppProcess.Service
    const commands = new Map<string, string[] | false>()
    let formatters: Info[] = []

    const load = yield* Effect.cached(
      Effect.gen(function* () {
        const configured = Config.latest(yield* config.entries(), "formatter")
        if (!configured) {
          yield* Effect.logInfo("all formatters are disabled")
          return
        }

        const builtIns = make({
          directory: location.directory,
          worktree: location.project.directory,
          fs,
          npm,
          processes,
        })
        formatters = builtIns
        if (configured === true) return

        for (const [name, entry] of Object.entries(configured)) {
          const index = formatters.findIndex((formatter) => formatter.name === name)
          if (entry.disabled) {
            if (index !== -1) formatters.splice(index, 1)
            continue
          }

          const builtIn = builtIns.find((formatter) => formatter.name === name)
          const formatter: Info = {
            name,
            extensions: entry.extensions ?? builtIn?.extensions ?? [],
            environment: { ...builtIn?.environment, ...entry.environment },
            enabled:
              builtIn && !entry.command ? builtIn.enabled : Effect.succeed(entry.command ? [...entry.command] : false),
          }
          if (index === -1) formatters.push(formatter)
          else formatters[index] = formatter
        }
      }).pipe(Effect.withSpan("Formatter.load")),
    )

    const command = Effect.fnUntraced(function* (formatter: Info) {
      const cached = commands.get(formatter.name)
      if (cached !== undefined) return cached
      const result = yield* formatter.enabled
      if (result !== false) commands.set(formatter.name, result)
      return result
    })

    const file = Effect.fn("Formatter.file")(function* (filepath: string) {
      yield* load
      const matching = formatters.filter((formatter) =>
        formatter.extensions.includes(path.extname(filepath)),
      )

      for (const formatter of matching) {
        const enabled = yield* command(formatter)
        if (enabled === false) continue
        const cmd = enabled.map((argument) => argument.replace("$FILE", filepath))
        yield* Effect.logInfo("formatting file", { file: filepath, command: cmd })
        const result = yield* processes
          .run(
            ChildProcess.make(cmd[0], cmd.slice(1), {
              cwd: location.directory,
              env: formatter.environment,
              extendEnv: true,
              stdin: "ignore",
              stdout: "ignore",
              stderr: "ignore",
            }),
          )
          .pipe(
            Effect.catch((error) =>
              Effect.logError("failed to format file", {
                file: filepath,
                command: cmd,
                error: error.message,
              }).pipe(Effect.as(undefined)),
            ),
          )
        if (!result) continue
        if (result.exitCode === 0) return true
        yield* Effect.logError("formatter exited unsuccessfully", {
          file: filepath,
          command: cmd,
          exitCode: result.exitCode,
        })
      }
      return false
    })

    return Service.of({ file })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node, Location.node, Npm.node, AppProcess.node],
})
