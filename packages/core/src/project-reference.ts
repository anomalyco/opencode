export * as ProjectReference from "./project-reference"

import path from "path"
import { Context, Effect, Layer } from "effect"
import { Config } from "./config"
import { ConfigReference } from "./config/reference"
import { FSUtil } from "./fs-util"
import { Flag } from "./flag/flag"
import { Global } from "./global"
import { Location } from "./location"
import { Repository } from "./repository"
import { RepositoryCache } from "./repository-cache"

export type Resolved =
  | { readonly name: string; readonly kind: "local"; readonly path: string }
  | {
      readonly name: string
      readonly kind: "git"
      readonly repository: string
      readonly reference: Repository.RemoteReference
      readonly path: string
      readonly branch?: string
    }
  | { readonly name: string; readonly kind: "invalid"; readonly repository?: string; readonly message: string }

type Valid = Exclude<Resolved, { kind: "invalid" }>

export type Mention =
  | {
      readonly name: string
      readonly kind: "reference"
      readonly reference: Valid
      readonly target?: string
      readonly path: string
    }
  | { readonly name: string; readonly kind: "invalid"; readonly target?: string; readonly message: string }
  | {
      readonly name: string
      readonly kind: "missing"
      readonly target: string
      readonly path: string
      readonly message: string
    }

export interface Interface {
  readonly list: () => Effect.Effect<Resolved[]>
  readonly get: (name: string) => Effect.Effect<Resolved | undefined>
  readonly resolveMention: (value: string) => Effect.Effect<Mention | undefined, RepositoryCache.Error>
  readonly ensurePath: (target?: string) => Effect.Effect<void, RepositoryCache.Error>
  readonly containsManagedPath: (target?: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ProjectReference") {}

type Materializer = {
  readonly name: string
  readonly repository: string
  readonly path: string
  readonly run: Effect.Effect<void, RepositoryCache.Error>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    if (!Flag.OPENCODE_EXPERIMENTAL_REFERENCES) return Service.of(inert)

    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const cache = yield* RepositoryCache.Service
    const references = resolveAll({
      references: ConfigReference.normalize(
        Object.assign(
          {},
          ...(yield* config.entries())
            .filter((entry): entry is Config.Document => entry.type === "document")
            .map((document) => document.info.references ?? {}),
        ),
      ),
      directory: location.project.directory,
      home: global.home,
      repos: global.repos,
    })
    const materializers = yield* Effect.forEach(
      uniqueGitReferences(references),
      Effect.fnUntraced(function* (reference) {
        return {
          name: reference.name,
          repository: reference.repository,
          path: reference.path,
          run: yield* Effect.cached(
            cache
              .ensure({ reference: reference.reference, branch: reference.branch, refresh: true })
              .pipe(Effect.asVoid),
          ),
        }
      }),
    )

    yield* Effect.forEach(
      materializers,
      (materializer) =>
        materializer.run.pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("failed to materialize project reference").pipe(
              Effect.annotateLogs({ name: materializer.name, repository: materializer.repository, cause }),
            ),
          ),
        ),
      { concurrency: 4, discard: true },
    ).pipe(Effect.forkScoped)

    const ensurePath = Effect.fn("ProjectReference.ensurePath")(function* (target?: string) {
      const normalized = normalizePath(target)
      if (!normalized)
        return yield* Effect.forEach(materializers, (materializer) => materializer.run, { discard: true })
      yield* materializers.find((materializer) => contains(materializer.path, normalized))?.run ?? Effect.void
    })

    return Service.of({
      list: Effect.fn("ProjectReference.list")(function* () {
        return references
      }),
      get: Effect.fn("ProjectReference.get")(function* (name: string) {
        return references.find((reference) => reference.name === name)
      }),
      ensurePath,
      containsManagedPath: Effect.fn("ProjectReference.containsManagedPath")(function* (target?: string) {
        const normalized = normalizePath(target)
        return normalized
          ? references.some((reference) => reference.kind === "git" && contains(reference.path, normalized))
          : false
      }),
      resolveMention: Effect.fn("ProjectReference.resolveMention")(function* (value: string) {
        const [name, ...rest] = value.split("/")
        const target = rest.length ? rest.join("/") : undefined
        const reference = references.find((reference) => reference.name === name)
        if (!reference) return
        if (reference.kind === "invalid") return { name, kind: "invalid", target, message: reference.message }
        if (reference.kind === "git") yield* ensurePath(reference.path)
        if (!target) return { name, kind: "reference", reference, path: reference.path }

        const resolved = path.resolve(reference.path, target)
        if (!FSUtil.contains(reference.path, resolved))
          return { name, kind: "invalid", target, message: "Reference target escapes its root" }
        if (!(yield* fs.existsSafe(resolved)))
          return { name, kind: "missing", target, path: resolved, message: "Reference target does not exist" }
        return { name, kind: "reference", reference, target, path: resolved }
      }),
    })
  }),
)

export const locationLayer = layer.pipe(Layer.provideMerge(Config.locationLayer))

const inert: Interface = {
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  resolveMention: () => Effect.succeed(undefined),
  ensurePath: () => Effect.void,
  containsManagedPath: () => Effect.succeed(false),
}

export function resolveAll(input: {
  references: ConfigReference.NormalizedInfo
  directory: string
  home: string
  repos: string
}) {
  const seen = new Map<string, { name: string; branch?: string }>()
  return Object.entries(input.references).map(([name, reference]): Resolved => {
    const resolved = resolve({ name, reference, directory: input.directory, home: input.home, repos: input.repos })
    if (resolved.kind !== "git") return resolved
    const existing = seen.get(resolved.path)
    if (!existing) {
      seen.set(resolved.path, { name, branch: resolved.branch })
      return resolved
    }
    if (existing.branch === resolved.branch) return resolved
    return {
      name,
      kind: "invalid",
      repository: resolved.repository,
      message: `Reference conflicts with @${existing.name}: both use ${resolved.path}, but @${existing.name} requests ${existing.branch ?? "default branch"} and @${name} requests ${resolved.branch ?? "default branch"}`,
    }
  })
}

export function resolve(input: {
  name: string
  reference: ConfigReference.NormalizedEntry
  directory: string
  home: string
  repos: string
}): Resolved {
  if (input.reference.kind === "invalid") return { name: input.name, kind: "invalid", message: input.reference.message }
  if (input.reference.kind === "local") {
    return { name: input.name, kind: "local", path: localPath(input.directory, input.home, input.reference.path) }
  }
  const reference = Repository.parse(input.reference.repository)
  if (!reference || !Repository.isRemote(reference)) {
    return {
      name: input.name,
      kind: "invalid",
      repository: input.reference.repository,
      message: "Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand",
    }
  }
  return {
    name: input.name,
    kind: "git",
    repository: input.reference.repository,
    reference,
    path: Repository.cachePath(input.repos, reference),
    branch: input.reference.branch,
  }
}

function localPath(directory: string, home: string, value: string) {
  if (value.startsWith("~/")) return path.join(home, value.slice(2))
  return path.isAbsolute(value) ? value : path.resolve(directory, value)
}

function uniqueGitReferences(references: Resolved[]) {
  const seen = new Set<string>()
  return references.filter((reference): reference is Extract<Resolved, { kind: "git" }> => {
    if (reference.kind !== "git" || seen.has(reference.path)) return false
    seen.add(reference.path)
    return true
  })
}

function normalizePath(target?: string) {
  if (!target) return
  return process.platform === "win32" ? FSUtil.normalizePath(target) : target
}

function contains(parent: string, child: string) {
  return FSUtil.contains(normalizePath(parent) ?? parent, normalizePath(child) ?? child)
}
