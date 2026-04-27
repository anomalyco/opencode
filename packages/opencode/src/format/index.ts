import { Effect, Layer, Context, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { InstanceState } from "@/effect"
import path from "path"
import { mergeDeep } from "remeda"
import { Config } from "../config"
import { Log } from "../util"
import * as Formatter from "./formatter"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

const log = Log.create({ service: "format" })

export const Status = Schema.Struct({
  name: Schema.String,
  extensions: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
})
  .annotate({ identifier: "FormatterStatus" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Status = Schema.Schema.Type<typeof Status>

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly status: () => Effect.Effect<Status[]>
  readonly file: (filepath: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Format") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    const state = yield* InstanceState.make(
      Effect.fn("Format.state")(function* (ctx) {
        const commands: Record<string, string[] | false> = {}
        const formatters: Record<string, Formatter.Info> = {}

        async function getCommand(item: Formatter.Info) {
          let cmd = commands[item.name]
          if (cmd === false || cmd === undefined) {
            cmd = await item.enabled(ctx)
            commands[item.name] = cmd
          }
          return cmd
        }

        async function isEnabled(item: Formatter.Info) {
          const cmd = await getCommand(item)
          return cmd !== false
        }

        async function getFormatter(ext: string) {
          const matching = Object.values(formatters).filter((item) => item.extensions.includes(ext))
          const checks = await Promise.all(
            matching.map(async (item) => {
              log.info("checking", { name: item.name, ext })
              const cmd = await getCommand(item)
              if (cmd) {
                log.info("enabled", { name: item.name, ext })
              }
              return {
                item,
                cmd,
              }
            }),
          )
          return checks
            .filter((x): x is { item: Formatter.Info; cmd: string[] } => x.cmd !== false)
            .map((x) => ({ item: x.item, cmd: x.cmd }))
        }

        function formatFile(filepath: string) {
          return Effect.gen(function* () {
            log.info("formatting", { file: filepath })
            const formatters = yield* Effect.promise(() => getFormatter(path.extname(filepath)))

            if (!formatters.length) return false

            for (const { item, cmd } of formatters) {
              log.info("running", { command: cmd })
              const replaced = cmd.map((x) => x.replace("$FILE", filepath))
              const dir = yield* InstanceState.directory
              const code = yield* spawner
                .spawn(
                  ChildProcess.make(replaced[0]!, replaced.slice(1), {
                    cwd: dir,
                    env: item.environment,
                    extendEnv: true,
                  }),
                )
                .pipe(
                  Effect.flatMap((handle) => handle.exitCode),
                  Effect.scoped,
                  Effect.catch(() =>
                    Effect.sync(() => {
                      log.error("failed to format file", {
                        error: "spawn failed",
                        command: cmd,
                        ...item.environment,
                        file: filepath,
                      })
                      return ChildProcessSpawner.ExitCode(1)
                    }),
                  ),
                )
              if (code !== 0) {
                log.error("failed", {
                  command: cmd,
                  ...item.environment,
                })
              }
            }

            return true
          })
        }

        const cfg = yield* config.get()

        if (!cfg.formatter) {
          log.info("all formatters are disabled")
          log.info("init")
          return {
            formatters,
            isEnabled,
            formatFile,
          }
        }

        for (const item of Object.values(Formatter)) {
          formatters[item.name] = item
        }

        if (cfg.formatter !== true) {
          for (const [name, item] of Object.entries(cfg.formatter)) {
            const builtIn = Formatter[name as keyof typeof Formatter]

            // Ruff and uv are both the same formatter, so disabling either should disable both.
            if (["ruff", "uv"].includes(name) && (cfg.formatter.ruff?.disabled || cfg.formatter.uv?.disabled)) {
              // TODO combine formatters so shared backends like Ruff/uv don't need linked disable handling here.
              delete formatters.ruff
              delete formatters.uv
              continue
            }
            if (item.disabled) {
              delete formatters[name]
              continue
            }
            const info = mergeDeep(builtIn ?? { extensions: [] }, item)

            formatters[name] = {
              ...info,
              name,
              extensions: info.extensions ?? [],
              enabled: builtIn && !info.command ? builtIn.enabled : async (_context) => info.command ?? false,
            }
          }
        }

        log.info("init")

        return {
          formatters,
          isEnabled,
          formatFile,
        }
      }),
    )

    const init = Effect.fn("Format.init")(function* () {
      yield* InstanceState.get(state)
    })

    const status = Effect.fn("Format.status")(function* () {
      const { formatters, isEnabled } = yield* InstanceState.get(state)
      const result: Status[] = []
      for (const formatter of Object.values(formatters)) {
        const isOn = yield* Effect.promise(() => isEnabled(formatter))
        result.push({
          name: formatter.name,
          extensions: formatter.extensions,
          enabled: isOn,
        })
      }
      return result
    })

    const file = Effect.fn("Format.file")(function* (filepath: string) {
      const { formatFile } = yield* InstanceState.get(state)
      return yield* formatFile(filepath)
    })

    return Service.of({ init, status, file })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

export * as Format from "."
