export * as Npm from "./npm.js"

import path from "path"
import { createHash, randomUUID } from "node:crypto"
import { Clock, Effect, Schema, Context, Layer, Option, FileSystem } from "effect"
import { FSUtil } from "./fs-util.js"
import { Global } from "./global.js"
import { EffectFlock } from "./effect-flock.js"
import { makeGlobalNode } from "./effect/app-node.js"
import { filesystem } from "./effect/app-node-platform.js"
import { LayerNode } from "./effect/layer-node.js"
import { makeRuntime } from "./effect/runtime.js"
import { NpmConfig } from "./npm-config.js"

export class InstallFailedError extends Schema.TaggedError<InstallFailedError>()("NpmInstallFailedError", {
  add: Schema.Array(Schema.String).pipe(Schema.optional),
  dir: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Package {
  readonly directory: string
  readonly name: string
  readonly version?: string
  readonly revision?: string
}

export interface Interface {
  readonly add: (pkg: string) => Effect.Effect<Package, InstallFailedError | EffectFlock.LockError>
  readonly resolve: (pkg: string) => Effect.Effect<Package>
  readonly check: (pkg: string) => Effect.Effect<boolean, InstallFailedError>
  readonly update: (pkg: string) => Effect.Effect<Package, InstallFailedError | EffectFlock.LockError>
  readonly which: (pkg: string, bin?: string) => Effect.Effect<string | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Npm") {}

const illegal = process.platform === "win32" ? new Set(["<", ">", ":", '"', "|", "?", "*"]) : undefined

export function sanitize(pkg: string) {
  if (!illegal) return pkg
  return Array.from(pkg, (char) => (illegal.has(char) || char.charCodeAt(0) < 32 ? "_" : char)).join("")
}

export async function isRegistryPackage(pkg: string) {
  return (await parse(pkg))?.type === "registry"
}

export async function isInstallablePackage(pkg: string) {
  return (await parse(pkg)) !== undefined
}

export async function cacheKey(pkg: string) {
  return key(pkg, await parse(pkg))
}

type Target =
  | { readonly type: "registry"; readonly name: string; readonly spec: string; readonly mutable: boolean }
  | { readonly type: "git"; readonly name?: string; readonly slug: string; readonly mutable: boolean }

async function parse(pkg: string): Promise<Target | undefined> {
  const { default: npa } = await import("npm-package-arg")
  try {
    const result = npa(pkg)
    if (result.type === "git") {
      return {
        type: "git",
        ...(result.name ? { name: result.name } : {}),
        slug: gitSlug(pkg),
        mutable: !isCommit(result.gitCommittish),
      }
    }
    if (!result.name || !["version", "range", "tag"].includes(result.type)) return
    return {
      type: "registry",
      name: result.name,
      spec: result.raw === result.name ? "latest" : result.rawSpec,
      mutable: result.type !== "version",
    }
  } catch {
    return
  }
}

function key(pkg: string, target: Target | undefined) {
  if (target?.type === "git")
    return `git-${target.slug}-${createHash("sha256").update(pkg).digest("hex").slice(0, 12)}`
  if (target?.type === "registry") return sanitize(`${target.name}@${target.spec}`)
  return sanitize(pkg)
}

function gitSlug(pkg: string) {
  const target = (() => {
    try {
      return decodeURIComponent(pkg.split("#")[0])
    } catch {
      return pkg.split("#")[0]
    }
  })()
  return (
    target
      .replace(/\.git$/i, "")
      .split(/[/:\\]/)
      .at(-1)
      ?.replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "repository"
  )
}

interface ArboristNode {
  name: string
  path: string
  realpath: string
  isLink: boolean
}

interface ArboristTree {
  edgesOut: Map<string, { to?: ArboristNode }>
  inventory: { values(): IterableIterator<ArboristNode> }
}

const PackageJson = Schema.Struct({
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  version: Schema.optional(Schema.String),
})

const PackageLock = Schema.Struct({
  packages: Schema.optional(Schema.Record(Schema.String, Schema.Struct({ resolved: Schema.optional(Schema.String) }))),
})

const retention = 7 * 24 * 60 * 60 * 1_000
const stagingRetention = 60 * 60 * 1_000

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const afs = yield* FSUtil.Service
    const global = yield* Global.Service
    const fs = yield* FileSystem.FileSystem
    const flock = yield* EffectFlock.Service
    const directory = (pkg: string, target: Target | undefined) => path.join(global.cache, "npm", key(pkg, target))
    const generations = Effect.fnUntraced(function* (dir: string) {
      return yield* fs.readDirectory(dir).pipe(
        Effect.orElseSucceed(() => [] as string[]),
        Effect.map((entries) =>
          entries
            .filter((entry) => /^\d+$/.test(entry))
            .toSorted((a, b) => Number(a) - Number(b)),
        ),
      )
    })
    const current = Effect.fnUntraced(function* (dir: string) {
      const latest = (yield* generations(dir)).at(-1)
      return latest ? path.join(dir, latest) : undefined
    })
    const mkdir = (dir: string) =>
      fs.makeDirectory(dir, { recursive: true }).pipe(
        Effect.mapError((cause) => new InstallFailedError({ dir, cause })),
      )
    const remove = (target: string, dir: string) =>
      fs.remove(target, { recursive: true, force: true }).pipe(
        Effect.mapError((cause) => new InstallFailedError({ dir, cause })),
      )
    const rename = (from: string, to: string, dir: string) =>
      fs.rename(from, to).pipe(Effect.mapError((cause) => new InstallFailedError({ dir, cause })))
    const installedName = Effect.fnUntraced(function* (pkg: string, dir: string, target?: Target) {
      if (target?.name) return target.name
      const manifest = yield* afs
        .readJson(path.join(dir, "package.json"))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PackageJson)), Effect.option)
      if (Option.isSome(manifest)) {
        const name = Object.keys(manifest.value.dependencies ?? {})[0]
        if (name) return name
      }
      return pkg
    })
    const installedRevision = Effect.fnUntraced(function* (root: string, name: string, target: Target) {
      const dir = path.join(root, "node_modules", name)
      if (target.type === "registry") {
        const manifest = yield* afs
          .readJson(path.join(dir, "package.json"))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PackageJson)), Effect.option)
        return Option.isSome(manifest) ? manifest.value.version : undefined
      }
      for (const file of [path.join(root, "package-lock.json"), path.join(root, "node_modules", ".package-lock.json")]) {
        const lock = yield* afs
          .readJson(file)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PackageLock)), Effect.option)
        const revision = gitRevision(
          Option.isSome(lock) ? lock.value.packages?.[`node_modules/${name}`]?.resolved : undefined,
        )
        if (revision) return revision
      }
    })
    const metadata = Effect.fnUntraced(function* (root: string, name: string, dir: string, target: Target | undefined) {
      const manifest = yield* afs
        .readJson(path.join(dir, "package.json"))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PackageJson)), Effect.option)
      const manifestVersion = Option.isSome(manifest) ? manifest.value.version : undefined
      const revision = target ? (yield* installedRevision(root, name, target)) ?? manifestVersion : undefined
      const version = target?.type === "git" ? revision : manifestVersion
      return {
        directory: dir,
        name,
        ...(version ? { version } : {}),
        ...(revision ? { revision } : {}),
      }
    })
    const reify = (input: { dir: string; config?: string; add?: string[]; update?: boolean }) =>
      Effect.gen(function* () {
        const { Arborist } = yield* Effect.promise(() => import("@npmcli/arborist"))
        const add = input.add ?? []
        const npmOptions = yield* NpmConfig.load(input.config ?? input.dir)
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

    const install = Effect.fnUntraced(function* (
      pkg: string,
      target: Target | undefined,
      dir: string,
      update: boolean,
    ) {
      yield* flock.acquire(`npm-install:${dir}`)
      const active = yield* current(dir)
      const name = yield* installedName(pkg, active ?? dir, target)
      if (active && !update && (yield* afs.existsSafe(path.join(active, "node_modules", name)))) {
        return yield* metadata(active, name, path.join(active, "node_modules", name), target)
      }

      yield* mkdir(dir)
      const startedAt = yield* Clock.currentTimeMillis
      const staging = path.join(dir, `.staging-${startedAt}-${randomUUID()}`)
      const staged = yield* Effect.gen(function* () {
        const tree = yield* reify({ dir: staging, config: dir, add: [pkg], update })
        const installed = tree.edgesOut.values().next().value?.to
        const installedNameValue = installed?.name ?? (yield* installedName(pkg, staging, target))
        const result = yield* metadata(
          staging,
          installedNameValue,
          installed?.path ?? path.join(staging, "node_modules", installedNameValue),
          target,
        )
        if (!installed && !(yield* afs.isDir(result.directory)))
          return yield* new InstallFailedError({ add: [pkg], dir: staging })
        const links =
          process.platform === "win32"
            ? Array.from(tree.inventory.values()).filter(
                (node) => node.isLink && FSUtil.contains(staging, node.path) && FSUtil.contains(staging, node.realpath),
              )
            : []
        return { result, links }
      }).pipe(Effect.onError(() => remove(staging, dir).pipe(Effect.ignore)))

      if (active) {
        const activeEntry = yield* metadata(active, name, path.join(active, "node_modules", name), target)
        if (activeEntry.revision && activeEntry.revision === staged.result.revision) {
          yield* remove(staging, dir)
          return activeEntry
        }
      }

      const completedAt = yield* Clock.currentTimeMillis
      const newest = Number((yield* generations(dir)).at(-1) ?? 0)
      const generation = path.join(dir, String(Math.max(completedAt, newest + 1)))
      // Windows junctions use absolute targets, so rebase internal links before publishing the generation.
      if (staged.links.length > 0) {
        const { unlink, symlink } = yield* Effect.promise(() => import("node:fs/promises"))
        yield* Effect.forEach(
          staged.links,
          (link) =>
            Effect.tryPromise({
              try: async () => {
                await unlink(link.path)
                await symlink(path.join(generation, path.relative(staging, link.realpath)), link.path, "junction")
              },
              catch: (cause) => new InstallFailedError({ dir, cause }),
            }),
          { discard: true },
        ).pipe(Effect.onError(() => remove(staging, dir).pipe(Effect.ignore)))
      }
      yield* rename(staging, generation, dir)
      return { ...staged.result, directory: path.join(generation, "node_modules", staged.result.name) }
    })

    const collect = Effect.fnUntraced(function* (dir: string) {
      const now = yield* Clock.currentTimeMillis
      const completed = yield* generations(dir)
      const keep = new Set(completed.slice(-2))
      const entries = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed(() => [] as string[]))
      yield* Effect.forEach(
        entries,
        (name) => {
          const timestamp = /^\d+$/.test(name)
            ? Number(name)
            : Number(name.match(/^\.staging-(\d+)-/)?.[1] ?? Number.NaN)
          const maximumAge = name.startsWith(".staging-") ? stagingRetention : retention
          if (!Number.isFinite(timestamp) || keep.has(name) || now - timestamp <= maximumAge) return Effect.void
          return remove(path.join(dir, name), dir).pipe(
            Effect.catchCause((cause) => Effect.logWarning("failed to remove stale npm generation", { dir, name, cause })),
          )
        },
        { concurrency: "unbounded", discard: true },
      )
    })

    const add = Effect.fn("Npm.add")(function* (pkg: string) {
      const target = yield* Effect.promise(() => parse(pkg))
      const dir = directory(pkg, target)
      return yield* install(pkg, target, dir, false)
    }, Effect.scoped)

    const resolve = Effect.fn("Npm.resolve")(function* (pkg: string) {
      const target = yield* Effect.promise(() => parse(pkg))
      const root = directory(pkg, target)
      const generation = yield* current(root)
      const name = yield* installedName(pkg, generation ?? root, target)
      const dir = path.join(generation ?? root, "node_modules", name)
      if (!(yield* afs.existsSafe(dir))) return { directory: dir, name }
      return yield* metadata(generation ?? root, name, dir, target)
    })

    const check = Effect.fn("Npm.check")(function* (pkg: string) {
      const target = yield* Effect.promise(() => parse(pkg))
      const root = directory(pkg, target)
      if (!target)
        return yield* new InstallFailedError({
          dir: root,
          cause: new Error("Package checks only support registry and Git package specs"),
        })
      if (!target.mutable) return false
      const generation = yield* current(root)
      const name = yield* installedName(pkg, generation ?? root, target)
      const installed = generation ? yield* installedRevision(generation, name, target) : undefined
      if (!installed)
        return yield* new InstallFailedError({ dir: root, cause: new Error(`Package is not installed: ${pkg}`) })
      const { manifest, resolve } = yield* Effect.promise(() => import("pacote"))
      const options = { ...(yield* NpmConfig.load(root)), preferOnline: true, noGitRevCache: true, ignoreScripts: true }
      const available = yield* Effect.tryPromise({
        try: async () =>
          target.type === "git" ? gitRevision(await resolve(pkg, options)) : (await manifest(pkg, options)).version,
        catch: (cause) => new InstallFailedError({ dir: root, cause }),
      })
      if (!available)
        return yield* new InstallFailedError({ dir: root, cause: new Error(`Package revision not found: ${pkg}`) })
      return installed !== available
    })

    const update = Effect.fn("Npm.update")(function* (pkg: string) {
      const target = yield* Effect.promise(() => parse(pkg))
      const dir = directory(pkg, target)
      if (!target)
        return yield* new InstallFailedError({
          dir,
          cause: new Error("Package updates only support registry and Git package specs"),
        })
      if (!target.mutable) return yield* add(pkg)
      const installed = yield* install(pkg, target, dir, true)
      yield* collect(dir)
      return installed
    }, Effect.scoped)

    const which = Effect.fn("Npm.which")(function* (pkg: string, bin?: string) {
      const target = yield* Effect.promise(() => parse(pkg))
      const root = directory(pkg, target)

      const pick = Effect.fnUntraced(function* (dir: string) {
        const binDir = path.join(dir, "node_modules", ".bin")
        const files = yield* fs.readDirectory(binDir).pipe(Effect.orElseSucceed(() => [] as string[]))

        if (files.length === 0) return Option.none<string>()
        // Caller picked a specific bin (e.g. pyright exposes both `pyright` and
        // `pyright-langserver`); trust the hint if the package provides it.
        if (bin) return files.includes(bin) ? Option.some(path.join(binDir, bin)) : Option.none<string>()
        if (files.length === 1) return Option.some(path.join(binDir, files[0]))

        const packageName = target?.name ?? pkg
        const pkgJson = yield* afs.readJson(path.join(dir, "node_modules", packageName, "package.json")).pipe(Effect.option)

        if (Option.isSome(pkgJson)) {
          const parsed = pkgJson.value as { bin?: string | Record<string, string> }
          if (parsed?.bin) {
            const unscoped = packageName.startsWith("@") ? packageName.split("/")[1] : packageName
            const parsedBin = parsed.bin
            if (typeof parsedBin === "string") return Option.some(path.join(binDir, unscoped))
            const keys = Object.keys(parsedBin)
            const selected = parsedBin[unscoped] ? unscoped : keys[0]
            return selected ? Option.some(path.join(binDir, selected)) : Option.none<string>()
          }
        }

        return Option.some(path.join(binDir, files[0]))
      })

      return Option.getOrUndefined(
        yield* Effect.gen(function* () {
          const generation = yield* current(root)
          const selected = generation ? yield* pick(generation) : Option.none<string>()
          if (Option.isSome(selected)) return selected

          yield* add(pkg)

          const installed = yield* current(root)
          if (!installed) return Option.none<string>()
          return yield* pick(installed)
        }).pipe(
          Effect.scoped,
          Effect.orElseSucceed(() => Option.none<string>()),
        ),
      )
    })

    return Service.of({
      add,
      resolve,
      check,
      update,
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

export async function check(...args: Parameters<Interface["check"]>) {
  return runPromise((svc) => svc.check(...args))
}

export async function update(...args: Parameters<Interface["update"]>) {
  return runPromise((svc) => svc.update(...args))
}

export async function which(...args: Parameters<Interface["which"]>) {
  return runPromise((svc) => svc.which(...args))
}

function gitRevision(resolved: string | undefined) {
  return resolved?.match(/#([a-f0-9]{40}|[a-f0-9]{64})(?=::|$)/i)?.[1]
}

function isCommit(value: string | null | undefined) {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value ?? "")
}
