export * as Npm from "./npm"

import path from "path"
import npa from "npm-package-arg"
import { Effect, Schema, Context, Layer, Option, FileSystem } from "effect"
import { FSUtil } from "./fs-util"
import { Global } from "./global"
import { EffectFlock } from "./util/effect-flock"
import { makeGlobalNode } from "./effect/app-node"
import { filesystem } from "./effect/app-node-platform"
import { LayerNode } from "./effect/layer-node"
import { makeRuntime } from "./effect/runtime"

export class InstallFailedError extends Schema.TaggedErrorClass<InstallFailedError>()("NpmInstallFailedError", {
  add: Schema.Array(Schema.String).pipe(Schema.optional),
  dir: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface EntryPoint {
  readonly directory: string
  readonly entrypoint?: string
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
  readonly which: (pkg: string, bin?: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Npm") {}

const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

export function sanitize(pkg: string) {
  if (!illegal) return pkg
  return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

const resolveEntryPoint = (name: string, dir: string): EntryPoint => {
  let entrypoint: string | undefined
  try {
    entrypoint = typeof Bun !== "undefined" ? import.meta.resolve(name, dir) : import.meta.resolve(dir)
  } catch {
    entrypoint = undefined
  }
  return {
    directory: dir,
    entrypoint,
  }
}

// aube's canonical lockfile plus package-lock.json left behind by the previous
// arborist-based installer.
const lockfiles = ["aube-lock.yaml", "package-lock.json"]

// Exact-version specs can resolve offline from the local store; anything else
// (tags, ranges, git, files) must not be served from a stale cached packument.
const isExactSpec = (spec: string) => {
  try {
    return npa(spec).type === "version"
  } catch {
    return false
  }
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const afs = yield* FSUtil.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const flock = yield* EffectFlock.Service
    const directory = (pkg: string) => path.join(global.cache, "packages", sanitize(pkg))
    const reify = (input: { dir: string; add?: string[] }) =>
      Effect.gen(function* () {
        yield* flock.acquire(`npm-install:${input.dir}`)
        const ffi = yield* Effect.promise(() => import("./aube-ffi/client"))
        const add = input.add ?? []
        if (add.length) {
          // aube_add expects an existing manifest; arborist created one on
          // demand, so preserve that behavior for fresh cache dirs.
          yield* Effect.promise(async () => {
            const fsp = await import("fs/promises")
            await fsp.mkdir(input.dir, { recursive: true })
            await fsp.writeFile(path.join(input.dir, "package.json"), "{}\n", { flag: "wx" }).catch(() => {})
          })
        }
        const omit = yield* Effect.promise(() => ffi.npmrcDepFlags(input.dir))
        const operation = (offline: boolean) =>
          add.length
            ? ({
                kind: "add" as const,
                projectDir: input.dir,
                packages: add,
                options: { saveExact: true, ignoreScripts: true, offline, ...omit },
              } as const)
            : ({
                kind: "install" as const,
                options: { projectDir: input.dir, ignoreScripts: true, offline, ...omit },
              } as const)
        const attempt = (offline: boolean) =>
          Effect.tryPromise({
            try: (signal) => ffi.run(operation(offline), signal),
            catch: (cause) =>
              new InstallFailedError({
                cause,
                add,
                dir: input.dir,
              }),
          })
        // A clean project or exact-version add resolves from the local store
        // with no registry traffic; tags and ranges go online so `latest`
        // cannot come from a stale cached packument.
        if (add.every(isExactSpec)) {
          return yield* attempt(true).pipe(Effect.catch(() => attempt(false)))
        }
        return yield* attempt(false)
      }).pipe(
        Effect.withSpan("Npm.reify", {
          attributes: input,
        }),
      )

    // Cache dirs hold a single package, so the manifest aube wrote names the
    // installed package even when the requested spec had no name portion.
    const installedName = (dir: string, requested: string) =>
      Effect.gen(function* () {
        if (yield* afs.existsSafe(path.join(dir, "node_modules", requested))) return requested
        const pkg = yield* afs.readJson(path.join(dir, "package.json")).pipe(Effect.orElseSucceed(() => ({})))
        const deps = (pkg as { dependencies?: Record<string, string> }).dependencies ?? {}
        return Object.keys(deps)[0] ?? requested
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

      if (yield* afs.existsSafe(path.join(dir, "node_modules", name))) {
        return resolveEntryPoint(name, path.join(dir, "node_modules", name))
      }

      yield* reify({ dir, add: [pkg] })
      const installed = yield* installedName(dir, name)
      const target = path.join(dir, "node_modules", installed)
      if (yield* afs.existsSafe(target)) {
        return resolveEntryPoint(installed, target)
      }
      const result = resolveEntryPoint(installed, target)
      if (result.entrypoint) return result
      return yield* new InstallFailedError({ add: [pkg], dir })
    }, Effect.scoped)

    const install: Interface["install"] = Effect.fn("Npm.install")(function* (dir, input) {
      const canWrite = yield* afs.access(dir, { writable: true }).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (!canWrite) return

      const add = input?.add.map((pkg) => [pkg.name, pkg.version].filter(Boolean).join("@")) ?? []
      yield* reify({ dir, add })
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

      return Option.getOrUndefined(
        yield* Effect.gen(function* () {
          const bin = yield* pick()
          if (Option.isSome(bin)) {
            return Option.some(path.join(binDir, bin.value))
          }

          yield* Effect.forEach(lockfiles, (file) =>
            fs.remove(path.join(dir, file)).pipe(Effect.orElseSucceed(() => {})),
          )

          yield* add(pkg)

          const resolved = yield* pick()
          if (Option.isNone(resolved)) return Option.none<string>()
          return Option.some(path.join(binDir, resolved.value))
        }).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => Option.none<string>()),
        ),
      )
    })

    return Service.of({
      add,
      install,
      which,
    })
  }),
)

export const node = makeGlobalNode({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, Global.node, filesystem, EffectFlock.node],
})

const { runPromise } = makeRuntime(Service, LayerNode.compile(node))

export async function install(...args: Parameters<Interface["install"]>) {
  return runPromise((svc) => svc.install(...args))
}

export async function add(...args: Parameters<Interface["add"]>) {
  return runPromise((svc) => svc.add(...args))
}

export async function which(...args: Parameters<Interface["which"]>) {
  return runPromise((svc) => svc.which(...args))
}
