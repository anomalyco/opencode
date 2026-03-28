import { Effect, Layer, ServiceMap } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import path from "path"
import { mergeDeep } from "remeda"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import * as Formatter from "./formatter"

export namespace Format {
  const log = Log.create({ service: "format" })

  export const Status = z
    .object({
      name: z.string(),
      extensions: z.string().array(),
      enabled: z.boolean(),
    })
    .meta({
      ref: "FormatterStatus",
    })
  export type Status = z.infer<typeof Status>

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly status: () => Effect.Effect<Status[]>
    readonly file: (filepath: string) => Effect.Effect<void>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Format") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const config = yield* Config.Service
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const state = yield* InstanceState.make(
        Effect.fn("Format.state")(function* (_ctx) {
          const enabled: Record<string, boolean> = {}
          const formatters: Record<string, Formatter.Info> = {}

          const cfg = yield* config.get()

          if (cfg.formatter !== false) {
            for (const item of Object.values(Formatter)) {
              formatters[item.name] = item
            }
            for (const [name, item] of Object.entries(cfg.formatter ?? {})) {
              if (item.disabled) {
                delete formatters[name]
                continue
              }
              const info = mergeDeep(formatters[name] ?? {}, {
                command: [],
                extensions: [],
                ...item,
              })

              if (info.command.length === 0) continue

              formatters[name] = {
                ...info,
                name,
                enabled: async () => true,
              }
            }
          } else {
            log.info("all formatters are disabled")
          }

          async function isEnabled(item: Formatter.Info) {
            let status = enabled[item.name]
            if (status === undefined) {
              status = await item.enabled()
              enabled[item.name] = status
            }
            return status
          }

          async function getFormatter(ext: string) {
            const matching = Object.values(formatters).filter((item) => item.extensions.includes(ext))
            const checks = await Promise.all(
              matching.map(async (item) => {
                log.info("checking", { name: item.name, ext })
                const on = await isEnabled(item)
                if (on) {
                  log.info("enabled", { name: item.name, ext })
                }
                return {
                  item,
                  enabled: on,
                }
              }),
            )
            return checks.filter((x) => x.enabled).map((x) => x.item)
          }

          function formatFile(filepath: string) {
            return Effect.gen(function* () {
              log.info("formatting", { file: filepath })
              const ext = path.extname(filepath)

              for (const item of yield* Effect.promise(() => getFormatter(ext))) {
                log.info("running", { command: item.command })
                const cmd = item.command.map((x) => x.replace("$FILE", filepath))
                const code = yield* spawner
                  .spawn(
                    ChildProcess.make(cmd[0]!, cmd.slice(1), {
                      cwd: Instance.directory,
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
                          command: item.command,
                          ...item.environment,
                          file: filepath,
                        })
                        return ChildProcessSpawner.ExitCode(1)
                      }),
                    ),
                  )
                if (code !== 0) {
                  log.error("failed", {
                    command: item.command,
                    ...item.environment,
                  })
                }
              }
            })
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
        yield* formatFile(filepath)
      })

      return Service.of({ init, status, file })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
  )

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function init() {
    return runPromise((s) => s.init())
  }

  export async function status() {
    return runPromise((s) => s.status())
  }

  export async function file(filepath: string) {
    return runPromise((s) => s.file(filepath))
  }
}
