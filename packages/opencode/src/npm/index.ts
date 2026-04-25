export * as Npm from "."

import path from "path"
import { fileURLToPath } from "url"
import npa from "npm-package-arg"
import semver from "semver"
import Config from "@npmcli/config"
import { definitions, flatten, nerfDarts, shorthands } from "@npmcli/config/lib/definitions/index.js"
import { Effect, Schema, Context, Layer, Option, FileSystem, Stream } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import * as CrossSpawnSpawner from "../effect/cross-spawn-spawner"

export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()("NpmInstallFailedError", {
  add: Schema.Array(Schema.String).pipe(Schema.optional),
  dir: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface EntryPoint {
  readonly directory: string
  readonly entrypoint: Option.Option<string>
}

export interface Interface {
  readonly add: (pkg: string) => Effect.Effect<EntryPoint, InstallFailedError | EffectFlock.LockError>
  readonly install: (
    dir: string,
    input?: {
      add: {
        name: string
        version?: string
      }[]
    },
  ) => Effect.Effect<void, EffectFlock.LockError | InstallFailedError>
  readonly outdated: (pkg: string, cachedVersion: string) => Effect.Effect<boolean>
  readonly which: (pkg: string, bin?: string) => Effect.Effect<Option.Option<string>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Npm") {}

const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined
const npmPath = fileURLToPath(new URL("../..", import.meta.url))

export function sanitize(pkg: string) {
  if (!illegal) return pkg
  return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

const loadOptions = (dir: string) =>
  Effect.tryPromise({
    try: async () => {
      const config = new Config({
        npmPath,
        cwd: dir,
        env: { ...process.env },
        argv: [process.execPath, process.execPath],
        execPath: process.execPath,
        platform: process.platform,
        definitions,
        flatten,
        nerfDarts,
        shorthands,
        warn: false,
      })
      await config.load()
      return config.flat
    },
    catch: (cause) =>
      new InstallFailedError({
        cause,
        dir,
      }),
  })

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
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const directory = (pkg: string) => path.join(global.cache, "packages", sanitize(pkg))
    const runView = Effect.fnUntraced(function* (cmd: string[]) {
      const handle = yield* spawner.spawn(
        ChildProcess.make(cmd[0], cmd.slice(1), {
          extendEnv: true,
        }),
      )
      const [stdout, stderr] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
        { concurrency: 2 },
      )
      const code = yield* handle.exitCode
      if (code !== 0 || !stdout.trim()) {
        return yield* Effect.fail(stderr || stdout || `Failed to run ${cmd.join(" ")}`)
      }
      return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.String))(stdout)
    }, Effect.scoped)
    const viewLatestVersion = Effect.fnUntraced(function* (pkg: string) {
      return yield* runView(["npm", "view", pkg, "dist-tags.latest", "--json"]).pipe(
        Effect.catch(() =>
          runView(["pnpm", "view", pkg, "dist-tags.latest", "--json"]).pipe(
            Effect.catch(() => runView(["bun", "pm", "view", pkg, "dist-tags.latest", "--json"])),
          ),
        ),
      )
    })
    const reify = (input: { dir: string; add?: string[] }) =>
      Effect.gen(function* () {
        yield* flock.acquire(`npm-install:${input.dir}`)
        const { Arborist } = yield* Effect.promise(() => import("@npmcli/arborist"))
        const add = input.add ?? []
        const npmOptions = yield* loadOptions(input.dir)
        const arborist = new Arborist({
          ...npmOptions,
          path: input.dir,
          binLinks: true,
          progress: false,
          savePrefix: "",
          ignoreScripts: true,
        })
        return yield* Effect.tryPromise({
          try: () =>
            arborist.reify({
              ...npmOptions,
              add,
              save: true,
              saveType: "prod",
            }),
          catch: (cause) =>
            new InstallFailedError({
              cause,
              add,
              dir: input.dir,
            }),
        }) as Effect.Effect<ArboristTree, InstallFailedError>
      }).pipe(
        Effect.withSpan("Npm.reify", {
          attributes: input,
        }),
      )

    const outdated = Effect.fn("Npm.outdated")(function* (pkg: string, cachedVersion: string) {
      const latestVersion = yield* viewLatestVersion(pkg).pipe(Effect.option)
      if (Option.isNone(latestVersion)) {
        return false
      }

      const range = /[\s^~*xX<>|=]/.test(cachedVersion)
      if (range) return !semver.satisfies(latestVersion.value, cachedVersion)

      return semver.lt(cachedVersion, latestVersion.value)
    })

    const add = Effect.fn("Npm.add")(function* (pkg: string) {
      const dir = directory(pkg)
      const name = (() => {
        try {
          return npa(pkg).name ?? pkg
        } catch {
          return pkg
        }
      })()

      if (yield* afs.existsSafe(dir)) {
        return resolveEntryPoint(name, path.join(dir, "node_modules", name))
      }

      const tree = yield* reify({ dir, add: [pkg] })
      const first = tree.edgesOut.values().next().value?.to
      if (!first) return yield* new InstallFailedError({ add: [pkg], dir })
      return resolveEntryPoint(first.name, first.path)
    }, Effect.scoped)

    const install: Interface["install"] = Effect.fn("Npm.install")(function* (dir, input) {
      const canWrite = yield* afs.access(dir, { writable: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (!canWrite) return

      const add = input?.add.map((pkg) => [pkg.name, pkg.version].filter(Boolean).join("@")) ?? []
      if (
        yield* Effect.gen(function* () {
          const nodeModulesExists = yield* afs.existsSafe(path.join(dir, "node_modules"))
          if (!nodeModulesExists) {
            yield* reify({ add, dir })
            return true
          }
          return false
        }).pipe(Effect.withSpan("Npm.checkNodeModules"))
      )
        return

      yield* Effect.gen(function* () {
        const pkg = yield* afs.readJson(path.join(dir, "package.json")).pipe(Effect.orElseSucceed(() => ({})))
        const lock = yield* afs.readJson(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => ({})))

        const pkgAny = pkg as any
        const lockAny = lock as any
        const declared = new Set([
          ...Object.keys(pkgAny?.dependencies || {}),
          ...Object.keys(pkgAny?.devDependencies || {}),
          ...Object.keys(pkgAny?.peerDependencies || {}),
          ...Object.keys(pkgAny?.optionalDependencies || {}),
          ...(input?.add || []).map((pkg) => pkg.name),
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
            yield* reify({ dir, add })
            return
          }
        }
      }).pipe(Effect.withSpan("Npm.checkDirty"))

      return
    }, Effect.scoped)

    const which = Effect.fn("Npm.which")(function* (pkg: string, bin?: string) {
      const dir = directory(pkg)
      const binDir = path.join(dir, "node_modules", ".bin")

      const pick = Effect.fnUntraced(function* () {
        const files = yield* fs.readDirectory(binDir).pipe(Effect.catch(() => Effect.succeed([] as string[])))

        if (files.length === 0) return Option.none<string>()
        // Caller picked a specific bin (e.g. pyright exposes both `pyright` and
        // `pyright-langserver`); trust the hint if the package provides it.
        if (bin) return files.includes(bin) ? Option.some(bin) : Option.none<string>()
        if (files.length === 1) return Option.some(files[0])

        const pkgJson = yield* afs.readJson(path.join(dir, "node_modules", pkg, "package.json")).pipe(Effect.option)

        if (Option.isSome(pkgJson)) {
          const parsed = pkgJson.value as { bin?: string | Record<string, string> }
          if (parsed?.bin) {
            const unscoped = pkg.startsWith("@") ? pkg.split("/")[1] : pkg
            const parsedBin = parsed.bin
            if (typeof parsedBin === "string") return Option.some(unscoped)
            const keys = Object.keys(parsedBin)
            if (keys.length === 1) return Option.some(keys[0])
            return parsedBin[unscoped] ? Option.some(unscoped) : Option.some(keys[0])
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
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export async function install(...args: Parameters<Interface["install"]>) {
  return runPromise((svc) => svc.install(...args))
}

export async function add(...args: Parameters<Interface["add"]>) {
  const entry = await runPromise((svc) => svc.add(...args))
  return {
    directory: entry.directory,
    entrypoint: Option.getOrUndefined(entry.entrypoint),
  }
}

export async function outdated(...args: Parameters<Interface["outdated"]>) {
  return runPromise((svc) => svc.outdated(...args))
}

export async function which(...args: Parameters<Interface["which"]>) {
  const resolved = await runPromise((svc) => svc.which(...args))
  return Option.getOrUndefined(resolved)
}
