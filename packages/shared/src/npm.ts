import path from "path"
import semver from "semver"
import { Arborist } from "@npmcli/arborist"
import { Effect, Schema, Context, Layer, Option, FileSystem } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "./filesystem"
import { Global } from "./global"
import { EffectFlock } from "./util/effect-flock"

export namespace Npm {
  export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()("NpmInstallFailedError", {
    pkg: Schema.String,
    cause: Schema.optional(Schema.Defect),
  }) {}

  export interface EntryPoint {
    readonly directory: string
    readonly entrypoint: Option.Option<string>
  }

  export interface Interface {
    readonly add: (pkg: string) => Effect.Effect<EntryPoint, InstallFailedError>
    readonly install: (dir: string) => Effect.Effect<void>
    readonly outdated: (pkg: string, cachedVersion: string) => Effect.Effect<boolean>
    readonly which: (pkg: string) => Effect.Effect<Option.Option<string>>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/Npm") {}

  const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

  export function sanitize(pkg: string) {
    if (!illegal) return pkg
    return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
  }

  const resolveEntryPoint = (name: string, dir: string): EntryPoint => {
    let entrypoint: Option.Option<string>
    try {
      const resolved = typeof Bun !== "undefined" ? import.meta.resolve(name, dir) : import.meta.resolve(dir)
      entrypoint = Option.some(resolved)
    } catch {
      entrypoint = Option.none()
    }
    return {
      directory: dir,
      entrypoint,
    }
  }

  interface ArboristNode {
    name: string
    path: string
  }

  interface ArboristTree {
    edgesOut: Map<string, { to?: ArboristNode }>
  }
  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const afs = yield* AppFileSystem.Service
      const global = yield* Global.Service
      const fs = yield* FileSystem.FileSystem
      const flock = yield* EffectFlock.Service
      const directory = (pkg: string) => path.join(global.cache, "packages", sanitize(pkg))

      const outdated = Effect.fn("Npm.outdated")(function* (pkg: string, cachedVersion: string) {
        const response = yield* Effect.tryPromise({
          try: () => fetch(`https://registry.npmjs.org/${pkg}`),
          catch: () => undefined,
        }).pipe(Effect.orElseSucceed(() => undefined))

        if (!response || !response.ok) {
          return false
        }

        const data = yield* Effect.tryPromise({
          try: () => response.json() as Promise<{ "dist-tags"?: { latest?: string } }>,
          catch: () => undefined,
        }).pipe(Effect.orElseSucceed(() => undefined))

        const latestVersion = data?.["dist-tags"]?.latest
        if (!latestVersion) {
          return false
        }

        const range = /[\s^~*xX<>|=]/.test(cachedVersion)
        if (range) return !semver.satisfies(latestVersion, cachedVersion)

        return semver.lt(cachedVersion, latestVersion)
      })

      const add = Effect.fn("Npm.add")(function* (pkg: string) {
        const dir = directory(pkg)
        yield* flock.acquire(`npm-install:${dir}`)

        const arborist = new Arborist({
          path: dir,
          binLinks: true,
          progress: false,
          savePrefix: "",
          ignoreScripts: true,
        })

        const tree = yield* Effect.tryPromise({
          try: () => arborist.loadVirtual().catch(() => undefined),
          catch: () => undefined,
        }).pipe(Effect.orElseSucceed(() => undefined)) as Effect.Effect<ArboristTree | undefined>

        if (tree) {
          const first = tree.edgesOut.values().next().value?.to
          if (first) {
            return resolveEntryPoint(first.name, first.path)
          }
        }

        const result = yield* Effect.tryPromise({
          try: () =>
            arborist.reify({
              add: [pkg],
              save: true,
              saveType: "prod",
            }),
          catch: (cause) => new InstallFailedError({ pkg, cause }),
        }) as Effect.Effect<ArboristTree, InstallFailedError>

        const first = result.edgesOut.values().next().value?.to
        if (!first) {
          return yield* new InstallFailedError({ pkg })
        }

        return resolveEntryPoint(first.name, first.path)
      }, Effect.scoped)

      const install = Effect.fn("Npm.install")(function* (dir: string) {
        yield* flock.acquire(`npm-install:${dir}`)

        const reify = Effect.fnUntraced(function* () {
          const arb = new Arborist({
            path: dir,
            binLinks: true,
            progress: false,
            savePrefix: "",
            ignoreScripts: true,
          })
          yield* Effect.tryPromise({
            try: () => arb.reify().catch(() => {}),
            catch: () => {},
          }).pipe(Effect.orElseSucceed(() => {}))
        })

        const nodeModulesExists = yield* afs.existsSafe(path.join(dir, "node_modules"))
        if (!nodeModulesExists) {
          yield* reify()
          return
        }

        const pkg = yield* afs.readJson(path.join(dir, "package.json")).pipe(Effect.orElseSucceed(() => ({})))
        const lock = yield* afs.readJson(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => ({})))

        const pkgAny = pkg as any
        const lockAny = lock as any

        const declared = new Set([
          ...Object.keys(pkgAny?.dependencies || {}),
          ...Object.keys(pkgAny?.devDependencies || {}),
          ...Object.keys(pkgAny?.peerDependencies || {}),
          ...Object.keys(pkgAny?.optionalDependencies || {}),
        ])

        const root = lockAny?.packages?.[""] || {}
        const locked = new Set([
          ...Object.keys(root?.dependencies || {}),
          ...Object.keys(root?.devDependencies || {}),
          ...Object.keys(root?.peerDependencies || {}),
          ...Object.keys(root?.optionalDependencies || {}),
        ])

        for (const name of declared) {
          if (!locked.has(name)) {
            yield* reify()
            return
          }
        }
      }, Effect.scoped)

      const which = Effect.fn("Npm.which")(function* (pkg: string) {
        const dir = directory(pkg)
        const binDir = path.join(dir, "node_modules", ".bin")

        const pick = Effect.fnUntraced(function* () {
          const files = yield* fs.readDirectory(binDir).pipe(Effect.catch(() => Effect.succeed([] as string[])))

          if (files.length === 0) return Option.none<string>()
          if (files.length === 1) return Option.some(files[0])

          const pkgJson = yield* afs.readJson(path.join(dir, "node_modules", pkg, "package.json")).pipe(Effect.option)

          if (Option.isSome(pkgJson)) {
            const parsed = pkgJson.value as { bin?: string | Record<string, string> }
            if (parsed?.bin) {
              const unscoped = pkg.startsWith("@") ? pkg.split("/")[1] : pkg
              const bin = parsed.bin
              if (typeof bin === "string") return Option.some(unscoped)
              const keys = Object.keys(bin)
              if (keys.length === 1) return Option.some(keys[0])
              return bin[unscoped] ? Option.some(unscoped) : Option.some(keys[0])
            }
          }

          return Option.some(files[0])
        })

        return yield* Effect.gen(function* () {
          const bin = yield* pick()
          if (Option.isSome(bin)) {
            return Option.some(path.join(binDir, bin.value))
          }

          yield* fs.remove(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => {}))

          yield* add(pkg)

          const resolved = yield* pick()
          if (Option.isNone(resolved)) return Option.none<string>()
          return Option.some(path.join(binDir, resolved.value))
        }).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => Option.none<string>()),
        )
      })

      return Service.of({
        add,
        install,
        outdated,
        which,
      })
    }),
  )

  export const defaultLayer = layer.pipe(
    Layer.provide(EffectFlock.layer),
    Layer.provide(AppFileSystem.layer),
    Layer.provide(Global.layer),
    Layer.provide(NodeFileSystem.layer),
  )
}
