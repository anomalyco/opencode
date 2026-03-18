import { Effect, Layer, ServiceMap } from "effect"
import { runPromiseInstance } from "@/effect/runtime"
import { InstanceContext } from "@/effect/instance-context"
import path from "path"
import { mergeDeep } from "remeda"
import z from "zod"
import { Bus } from "../bus"
import { Config } from "../config/config"
import { File } from "../file"
import { Instance } from "../project/instance"
import { Process } from "../util/process"
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
    readonly status: () => Effect.Effect<Status[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Format") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const instance = yield* InstanceContext

      const enabled: Record<string, boolean> = {}
      const formatters: Record<string, Formatter.Info> = {}

      const cfg = yield* Effect.promise(() => Config.get())

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
        const result = []
        for (const item of Object.values(formatters)) {
          log.info("checking", { name: item.name, ext })
          if (!item.extensions.includes(ext)) continue
          if (!(await isEnabled(item))) continue
          log.info("enabled", { name: item.name, ext })
          result.push(item)
        }
        return result
      }

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          Bus.subscribe(
            File.Event.Edited,
            Instance.bind(async (payload) => {
              const file = payload.properties.file
              log.info("formatting", { file })
              const ext = path.extname(file)

              for (const item of await getFormatter(ext)) {
                log.info("running", { command: item.command })
                try {
                  const proc = Process.spawn(
                    item.command.map((x) => x.replace("$FILE", file)),
                    {
                      cwd: instance.directory,
                      env: { ...process.env, ...item.environment },
                      stdout: "ignore",
                      stderr: "ignore",
                    },
                  )
                  const exit = await proc.exited
                  if (exit !== 0) {
                    log.error("failed", {
                      command: item.command,
                      ...item.environment,
                    })
                  }
                } catch (error) {
                  log.error("failed to format file", {
                    error,
                    command: item.command,
                    ...item.environment,
                    file,
                  })
                }
              }
            }),
          ),
        ),
        (unsubscribe) => Effect.sync(unsubscribe),
      )
      log.info("init")

      const status = Effect.fn("Format.status")(function* () {
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

      return Service.of({ status })
    }),
  )

  export async function status() {
    return runPromiseInstance(Service.use((s) => s.status()))
  }
}
