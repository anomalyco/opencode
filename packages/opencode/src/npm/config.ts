import { createRequire } from "module"
import path from "path"
import Config from "@npmcli/config"
import { definitions, flatten, shorthands } from "@npmcli/config/lib/definitions/index.js"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { Global } from "@/global"

export namespace NpmConfig {
  type Data = Record<string, unknown>
  type Where = "project" | "user" | "global"

  export interface Interface {
    readonly config: (dir: string) => Effect.Effect<Data, Error>
    readonly paths: (dir: string) => Effect.Effect<string[], Error>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/NpmConfig") {}

  const require = createRequire(import.meta.url)
  const npmPath = (() => {
    try {
      return path.dirname(require.resolve("npm/package.json"))
    } catch {
      return path.join(Global.Path.cache, "npm")
    }
  })()

  function source(conf: Config, where: Where) {
    return conf.data.get(where)?.source
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service

      const load = Effect.fnUntraced(function* (dir: string) {
        const conf = new Config({
          argv: [],
          cwd: AppFileSystem.resolve(dir),
          definitions,
          env: { ...process.env },
          execPath: process.execPath,
          flatten,
          npmPath,
          platform: process.platform,
          shorthands,
          warn: false,
        })
        yield* Effect.tryPromise({
          try: () => conf.load(),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        })
        return conf
      })

      const config = Effect.fn("NpmConfig.config")(function* (dir: string) {
        return (yield* load(dir)).flat as Data
      })

      const paths = Effect.fn("NpmConfig.paths")(function* (dir: string) {
        const conf = yield* load(dir)
        const list = yield* Effect.forEach(["project", "user", "global"] as const, (where) =>
          Effect.gen(function* () {
            const file = source(conf, where)
            if (!file || !path.isAbsolute(file)) return
            const resolved = AppFileSystem.resolve(file)
            if (!(yield* fs.existsSafe(resolved))) return
            return resolved
          }),
        )
        return list.filter((item): item is string => item !== undefined)
      })

      return Service.of({ config, paths })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))
  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function config(dir: string) {
    return runPromise((svc) => svc.config(dir))
  }

  export async function paths(dir: string) {
    return runPromise((svc) => svc.paths(dir))
  }
}
