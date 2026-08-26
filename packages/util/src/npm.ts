export * as Npm from "./npm.js"

import path from "path"
import { createHash, randomUUID } from "node:crypto"
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
  readonly revision?: string
}

export interface UpdateInfo {
  readonly updateable: boolean
  readonly pinned: boolean
  readonly currentVersion?: string
  readonly latestVersion?: string
  readonly updateAvailable: boolean
}

export interface UpdateResult extends UpdateInfo {
  readonly previousVersion?: string
  readonly updated: boolean
}

export interface Interface {
  readonly add: (
    pkg: string,
    options?: { readonly subpaths?: readonly string[] },
  ) => Effect.Effect<EntryPoint, InstallFailedError | EffectFlock.LockError>
  readonly resolve: (pkg: string, options?: { readonly subpaths?: readonly string[] }) => Effect.Effect<EntryPoint>
  readonly check: (pkg: string) => Effect.Effect<UpdateInfo, InstallFailedError | EffectFlock.LockError>
  readonly update: (pkg: string) => Effect.Effect<UpdateResult, InstallFailedError | EffectFlock.LockError>
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

export async function updatePolicy(pkg: string) {
  const { default: npa } = await import("npm-package-arg")
  try {
    const parsed = npa(pkg)
    const registry = ["version", "range", "tag"].includes(parsed.type)
    const git = ["git", "hosted"].includes(parsed.type)
    if (parsed.type === "version" || (git && /^[a-f0-9]{40,64}$/i.test(parsed.gitCommittish ?? ""))) {
      return "pinned" as const
    }
    if (registry || git) return "mutable" as const
    return "unsupported" as const
  } catch {
    return "unsupported" as const
  }
}

export async function cacheKey(pkg: string) {
  const { default: npa } = await import("npm-package-arg")
  try {
    if (npa(pkg).type === "git") {
      return `git-${createHash("sha256").update(pkg).digest("hex")}`
    }
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
  version?: string
  resolved?: string
}

interface ArboristTree {
  edgesOut: Map<string, { to?: ArboristNode }>
}

const PackageJson = Schema.Struct({
  version: Schema.optional(Schema.String),
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const PackageLock = Schema.Struct({
  packages: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        version: Schema.optional(Schema.String),
        resolved: Schema.optional(Schema.String),
      }),
    ),
  ),
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
    const activeDirectory = Effect.fnUntraced(function* (dir: string) {
      const active = yield* afs
        .readFileStringSafe(path.join(dir, ".opencode-active"))
        .pipe(Effect.orElseSucceed(() => undefined))
      if (!active) return dir
      const resolved = path.resolve(active.trim())
      if (!resolved.startsWith(`${dir}-revision-`)) return dir
      return resolved
    })
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
    const installed = Effect.fnUntraced(function* (pkg: string, dir: string, parsedName?: string) {
      const name = yield* installedName(pkg, dir, parsedName)
      const directory = path.join(dir, "node_modules", name)
      const manifest = yield* afs
        .readJson(path.join(directory, "package.json"))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PackageJson)), Effect.option)
      const lock = yield* afs
        .readJson(path.join(dir, "package-lock.json"))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(PackageLock)), Effect.option)
      const entry = Option.isSome(lock) ? lock.value.packages?.[`node_modules/${name}`] : undefined
      return {
        name,
        directory,
        version: packageVersion({
          name,
          path: directory,
          version: Option.isSome(manifest) ? manifest.value.version : entry?.version,
          resolved: entry?.resolved,
        }),
      }
    })
    const reify = (input: { dir: string; add?: string[]; update?: boolean }) =>
      Effect.gen(function* () {
        yield* flock.acquire(`npm-install:${input.dir}`)
        const { Arborist } = yield* Effect.promise(() => import("@npmcli/arborist"))
        const add = input.add ?? []
        const npmOptions = yield* NpmConfig.load(input.dir)
        const options = input.update ? { ...npmOptions, preferOnline: true } : npmOptions
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

    const parse = Effect.fnUntraced(function* (pkg: string) {
      const { default: npa } = yield* Effect.promise(() => import("npm-package-arg"))
      return yield* Effect.try({
        try: () => npa(pkg),
        catch: (cause) => new InstallFailedError({ cause, dir: path.join(global.cache, "packages") }),
      })
    })
    const check = Effect.fn("Npm.check")(function* (pkg: string) {
      const parsed = yield* parse(pkg)
      const policy = yield* Effect.promise(() => updatePolicy(pkg))
      if (policy !== "mutable") {
        const version =
          parsed.type === "version"
            ? (parsed.fetchSpec ?? undefined)
            : policy === "pinned"
              ? (parsed.gitCommittish ?? undefined)
              : undefined
        return {
          updateable: false,
          pinned: policy === "pinned",
          currentVersion: version,
          latestVersion: version,
          updateAvailable: false,
          updated: false,
        }
      }

      const root = yield* directory(pkg)
      const dir = yield* activeDirectory(root)
      const current = yield* installed(pkg, dir, parsed.name ?? undefined)
      const npmOptions = yield* NpmConfig.load(root)
      const { default: pacote } = yield* Effect.promise(() => import("pacote"))
      const latestVersion = yield* Effect.tryPromise({
        try: async () => {
          if (["git", "hosted"].includes(parsed.type)) {
            const { execFile } = await import("node:child_process")
            const { promisify } = await import("node:util")
            const repository =
              parsed.fetchSpec ??
              (parsed.hosted
                ? `https://${parsed.hosted.domain}/${parsed.hosted.user}/${parsed.hosted.project}.git`
                : undefined)
            if (!repository) throw new Error("Git repository URL unavailable")
            const ref = parsed.gitCommittish ?? "HEAD"
            const { stdout } = await promisify(execFile)("git", ["ls-remote", repository, ref, `${ref}^{}`], {
              encoding: "utf8",
              env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
            })
            return stdout
              .trim()
              .split("\n")
              .map((line) => line.split(/\s+/, 1)[0])
              .at(-1)
          }
          const manifest = await pacote.manifest(pkg, { ...npmOptions, preferOnline: true })
          return manifest.version
        },
        catch: (cause) => new InstallFailedError({ cause, add: [pkg], dir }),
      })
      return {
        updateable: true,
        pinned: false,
        currentVersion: current.version,
        latestVersion,
        updateAvailable: latestVersion !== undefined && current.version !== latestVersion,
      }
    })

    const update = Effect.fn("Npm.update")(function* (pkg: string) {
      const parsed = yield* parse(pkg)
      const policy = yield* Effect.promise(() => updatePolicy(pkg))
      if (policy !== "mutable") {
        const checked = yield* check(pkg)
        return { ...checked, previousVersion: checked.currentVersion, updated: false }
      }
      const root = yield* directory(pkg)
      const previous = yield* installed(pkg, yield* activeDirectory(root), parsed.name ?? undefined)
      const checked = yield* check(pkg)
      yield* flock.acquire(`npm-install:${root}`)
      const dir = `${root}-revision-${createHash("sha256").update(`${Date.now()}:${randomUUID()}`).digest("hex")}`
      const target =
        ["git", "hosted"].includes(parsed.type) && checked.latestVersion ? pinGitSpec(pkg, checked.latestVersion) : pkg
      const tree = yield* reify({ dir, add: [target], update: true })
      const node = parsed.name ? tree.edgesOut.get(parsed.name)?.to : tree.edgesOut.values().next().value?.to
      const version = packageVersion(node)
      yield* afs
        .writeWithDirs(path.join(root, ".opencode-active"), dir)
        .pipe(Effect.mapError((cause) => new InstallFailedError({ cause, dir: root })))
      return {
        updateable: true,
        pinned: false,
        currentVersion: version,
        latestVersion: version,
        updateAvailable: false,
        previousVersion: previous.version,
        updated: version !== undefined,
      }
    }, Effect.scoped)

    const add = Effect.fn("Npm.add")(function* (pkg: string, options?: { readonly subpaths?: readonly string[] }) {
      const { default: npa } = yield* Effect.promise(() => import("npm-package-arg"))
      const root = yield* directory(pkg)
      const dir = yield* activeDirectory(root)
      const parsedName = (() => {
        try {
          return npa(pkg).name ?? undefined
        } catch {
          return undefined
        }
      })()
      const name = yield* installedName(pkg, dir, parsedName)

      if (yield* afs.existsSafe(path.join(dir, "node_modules", name))) {
        const result = resolveEntryPoint(name, path.join(dir, "node_modules", name), options?.subpaths)
        return { ...result, revision: (yield* installed(pkg, dir, parsedName)).version }
      }

      const tree = yield* reify({ dir, add: [pkg] })
      const first = tree.edgesOut.values().next().value?.to
      if (!first) {
        const installed = yield* installedName(pkg, dir, parsedName)
        const result = resolveEntryPoint(installed, path.join(dir, "node_modules", installed), options?.subpaths)
        if (result.entrypoint) return result
        return yield* new InstallFailedError({ add: [pkg], dir })
      }
      return { ...resolveEntryPoint(first.name, first.path, options?.subpaths), revision: packageVersion(first) }
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
      const root = yield* activeDirectory(yield* directory(pkg))
      const name = yield* installedName(pkg, root, parsedName)
      const dir = path.join(root, "node_modules", name)
      if (!(yield* afs.existsSafe(dir))) return { directory: dir }
      return {
        ...resolveEntryPoint(name, dir, options?.subpaths),
        revision: (yield* installed(pkg, root, parsedName)).version,
      }
    })

    const which = Effect.fn("Npm.which")(function* (pkg: string, bin?: string) {
      const dir = yield* activeDirectory(yield* directory(pkg))
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
      check,
      resolve,
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

function packageVersion(node: ArboristNode | undefined) {
  if (!node) return undefined
  const commit = node.resolved?.match(/#([a-f0-9]{40,64})$/i)?.[1]
  return commit ?? node.version ?? node.resolved
}

function pinGitSpec(pkg: string, commit: string) {
  const subdirectory = pkg.indexOf("::")
  const source = subdirectory === -1 ? pkg : pkg.slice(0, subdirectory)
  const suffix = subdirectory === -1 ? "" : pkg.slice(subdirectory)
  const hash = source.lastIndexOf("#")
  return `${hash === -1 ? `${source}#` : source.slice(0, hash + 1)}${commit}${suffix}`
}
