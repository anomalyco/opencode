import path from "path"
import { Effect, Layer, Context, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import * as Registry from "./registry"
import * as Source from "./source"
import * as Install from "./install"
import { InstalledPkg, MARKETPLACE_META_FILE } from "./types"

export interface Interface {
  readonly install: (pkgName: string, source: string) => Effect.Effect<void, Error>
  readonly uninstall: (name: string) => Effect.Effect<void>
  readonly list: () => Effect.Effect<readonly InstalledPkg[]>
  readonly info: (name: string) => Effect.Effect<InstalledPkg | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Marketplace") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const registrySvc = yield* Registry.Service
    const sourceSvc = yield* Source.Service
    const installSvc = yield* Install.Service

    const metaFile = path.join(global.state, MARKETPLACE_META_FILE)

    const readStore = (): Effect.Effect<Record<string, InstalledPkg>> =>
      Effect.gen(function* () {
        const data = yield* fs.readFileStringSafe(metaFile).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!data) return {}
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>
          const result: Record<string, InstalledPkg> = {}
          for (const [key, val] of Object.entries(parsed)) {
            try {
              const decoded = Schema.decodeUnknownSync(InstalledPkg)(val)
              result[key] = decoded
            } catch {
              continue
            }
          }
          return result
        } catch {
          return {}
        }
      })

    const writeStore = (store: Record<string, InstalledPkg>): Effect.Effect<void> =>
      fs.writeWithDirs(metaFile, JSON.stringify(store, null, 2)).pipe(Effect.catch(() => Effect.void))

    const installPkg: Interface["install"] = (pkgName: string, sourceStr: string) =>
      Effect.gen(function* () {
        const fetched = yield* sourceSvc.fetch(pkgName, sourceStr)
        if (!fetched.dir || !fetched.sourceUrl) {
          return yield* Effect.fail(new Error(`Failed to fetch "${pkgName}" from "${sourceStr}"`))
        }
        const result = yield* installSvc.install(pkgName, fetched.dir)

        const existing = yield* readStore()
        existing[pkgName] = new InstalledPkg({
          name: pkgName,
          source: sourceStr,
          sourceUrl: fetched.sourceUrl,
          assets: result.assets,
          installedAt: Date.now(),
        })
        yield* writeStore(existing)

        yield* Effect.promise(() =>
          import("fs/promises").then((f) => f.rm(fetched.dir, { recursive: true, force: true })),
        ).pipe(Effect.ignore)
      })

    const uninstallPkg: Interface["uninstall"] = (name: string) =>
      Effect.gen(function* () {
        const store = yield* readStore()
        const entry = store[name]
        if (!entry) return

        const assets = entry.assets ?? new Install.Assets({ skills: [], agents: []})
        yield* installSvc.uninstall(name, assets)

        delete store[name]
        yield* writeStore(store)
      })

    const list: Interface["list"] = () =>
      Effect.gen(function* () {
        const store = yield* readStore()
        return Object.values(store)
      })

    const info: Interface["info"] = (name: string) =>
      Effect.gen(function* () {
        const store = yield* readStore()
        return store[name]
      })

    return Service.of({
      install: installPkg,
      uninstall: uninstallPkg,
      list,
      info,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Registry.defaultLayer),
  Layer.provide(Source.defaultLayer),
  Layer.provide(Install.defaultLayer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Global.defaultLayer),
)

export * as Marketplace from "."
