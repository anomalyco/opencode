export * as Npm from "./npm.js"

import path from "path"
import { createHash } from "node:crypto"
import { Effect, Schema, Context, Layer, Option, FileSystem } from "effect"
import { FSUtil } from "./fs-util.js"
import { Global } from "./global.js"
import { EffectFlock } from "./effect-flock.js"
import { makeGlobalNode } from "./effect/app-node.js"
import { filesystem } from "./effect/app-node-platform.js"
import { LayerNode } from "./effect/layer-node.js"
import { makeRuntime } from "./effect/runtime.js"
import { NpmConfig } from "./npm-config.js"
import { resolveModule } from "#runtime-import"

export class InstallFailedError extends Schema.TaggedError<InstallFailedError>()("NpmInstallFailedError", {
  add: Schema.Array(Schema.String).pipe(Schema.optional),
  dir: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface EntryPoint {
  readonly directory: string
  readonly entrypoint?: string
}

export interface Interface {
  readonly add: (
    pkg: string,
    options?: { readonly subpaths?: readonly string[]; readonly refresh?: boolean },
  ) => Effect.Effect<EntryPoint, InstallFailedError | EffectFlock.LockError>
  readonly resolve: (pkg: string, options?: { readonly subpaths?: readonly string[] }) => Effect.Effect<EntryPoint>
  readonly which: (pkg: string, bin?: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Npm") {}

const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

export function sanitize(pkg: string) {
  if (!illegal) return pkg
  return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

export async function isRegistryPackage(pkg: string) {
  const { default: npa } = await import("npm-package-arg")
  try {
    const result = npa(pkg)
    return result.name !== undefined && ["version", "range", "tag"].includes(result.type)
  } catch {
    return false
  }
}

export async function isInstallablePackage(pkg: string) {
  const { default: npa } = await import("npm-package-arg")
  try {
    const result = npa(pkg)
    return result.type === "git" || (result.name !== undefined && ["version", "range", "tag"].includes(result.type))
  } catch {
    return false
  }
}

export async function cacheKey(pkg: string) {
  const { default: npa } = await import("npm-package-arg")
  try {
    if (npa(pkg).type === "git") return `git-${createHash("sha256").update(pkg).digest("hex")}`
  } catch {
    // Preserve the existing fallback for invalid and non-registry package strings.
  }
  return sanitize(pkg)
}

const resolveEntryPoint = (name: string, dir: string, subpaths: readonly string[] = [""]): EntryPoint => {
  const entrypoint = subpaths
    .map((subpath) => {
      try {
        return resolveModule([name, subpath].filter(Boolean).join("/"), dir)
      } catch {
        return undefined
      }
    })
    .find((entrypoint) => entrypoint !== undefined)
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

const PackageJson = Schema.Struct({
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const afs = yield* FSUtil.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const flock = yield* EffectFlock.Service
    const directory = (pkg: string) =>
      Effect.map(
        Effect.promise(() => cacheKey(pkg)),
        (key) => path.join(global.cache, "packages", key),
      )
    const installedName = Effect.fnUntraced(function* (pkg: string, dir: string, parsedName?: string) {
      if (parsedName) return parsedName
      const manifest = yield* afs
        .readJson(path.join(dir, "package.json"))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PackageJson)), Effect.option)
      if (Option.isSome(manifest)) {
        const name = Object.keys(manifest.value.dependencies ?? {})[0]
        if (name) return name
      }
      return pkg
    })
    const refreshed = new Set<string>()
    const reify = (input: { dir: string; add?: string[]; update?: boolean }) =>
      Effect.gen(function* () {
        yield* flock.acquire(`npm-install:${input.dir}`)
        const { Arborist } = yield* Effect.promise(() => import("@npmcli/arborist"))
        const add = input.add ?? []
        const npmOptions = yield* NpmConfig.load(input.dir)
        const options = input.update ? { ...npmOptions, preferOnline: true, noGitRevCache: true } : npmOptions
        const arborist = new Arborist({
          ...options,
          path: input.dir,
          binLinks: true,
          progress: false,
          savePrefix: "",
          ignoreScripts: true,
        })
        return yield* Effect.tryPromise({
          try: () =>
            arborist.reify({
              ...options,
              add,
              update: input.update,
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

    const add = Effect.fn("Npm.add")(function* (
      pkg: string,
      options?: { readonly subpaths?: readonly string[]; readonly refresh?: boolean },
    ) {
      const { default: npa } = yield* Effect.promise(() => import("npm-package-arg"))
      const parsed = (() => {
        try {
          return npa(pkg)
        } catch {
          return undefined
        }
      })()
      const parsedName = parsed?.name ?? undefined
      const dir = yield* directory(pkg)
      const name = yield* installedName(pkg, dir, parsedName)
      const cached = yield* afs.existsSafe(path.join(dir, "node_modules", name))
      const refresh = options?.refresh && isMutable(parsed) && !refreshed.has(pkg)

      if (refresh) {
        refreshed.add(pkg)
        if (cached)
          yield* reify({ dir, add: [pkg], update: true }).pipe(
            Effect.catchCause(() => Effect.logWarning("failed to refresh cached package; using installed version")),
          )
      }

      if (cached) {
        return resolveEntryPoint(name, path.join(dir, "node_modules", name), options?.subpaths)
      }

      const tree = yield* reify({ dir, add: [pkg] })
      if (isMutable(parsed)) refreshed.add(pkg)
      const first = tree.edgesOut.values().next().value?.to
      if (!first) {
        const installed = yield* installedName(pkg, dir, parsedName)
        const result = resolveEntryPoint(installed, path.join(dir, "node_modules", installed), options?.subpaths)
        if (result.entrypoint) return result
        return yield* new InstallFailedError({ add: [pkg], dir })
      }
      return resolveEntryPoint(first.name, first.path, options?.subpaths)
    }, Effect.scoped)

    const resolve = Effect.fn("Npm.resolve")(function* (
      pkg: string,
      options?: { readonly subpaths?: readonly string[] },
    ) {
      const { default: npa } = yield* Effect.promise(() => import("npm-package-arg"))
      const parsedName = (() => {
        try {
          return npa(pkg).name ?? undefined
        } catch {
          return undefined
        }
      })()
      const root = yield* directory(pkg)
      const name = yield* installedName(pkg, root, parsedName)
      const dir = path.join(root, "node_modules", name)
      if (!(yield* afs.existsSafe(dir))) return { directory: dir }
      return resolveEntryPoint(name, dir, options?.subpaths)
    })

    const which = Effect.fn("Npm.which")(function* (pkg: string, bin?: string) {
      const dir = yield* directory(pkg)
      const binDir = path.join(dir, "node_modules", ".bin")

      const pick = Effect.fnUntraced(function* () {
        const files = yield* fs.readDirectory(binDir).pipe(Effect.orElseSucceed(() => [] as string[]))

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

          yield* fs.remove(path.join(dir, "package-lock.json")).pipe(Effect.orElseSucceed(() => {}))

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
      resolve,
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

export async function add(...args: Parameters<Interface["add"]>) {
  return runPromise((svc) => svc.add(...args))
}

export async function resolve(...args: Parameters<Interface["resolve"]>) {
  return runPromise((svc) => svc.resolve(...args))
}

export async function which(...args: Parameters<Interface["which"]>) {
  return runPromise((svc) => svc.which(...args))
}

function isMutable(parsed: { readonly type: string; readonly gitCommittish?: string | null } | undefined) {
  if (!parsed) return false
  if (["tag", "range"].includes(parsed.type)) return true
  if (parsed.type !== "git") return false
  return !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(parsed.gitCommittish ?? "")
}
