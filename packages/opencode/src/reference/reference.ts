import path from "path"
import { Effect, Context, Layer, Scope } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Config } from "@/config/config"
import { ConfigReference } from "@/config/reference"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { parseRepositoryReference, repositoryCachePath, type RemoteReference } from "@/util/repository"
import { RepositoryCache } from "./repository-cache"

export type Resolved =
  | {
      name: string
      kind: "local"
      path: string
    }
  | {
      name: string
      kind: "git"
      repository: string
      reference: RemoteReference
      path: string
      branch?: string
    }
  | {
      name: string
      kind: "invalid"
      repository?: string
      message: string
    }

type State = {
  references: Resolved[]
  materializeAll: Effect.Effect<void>
  materializeByPath: Materializer[]
}

type Materializer = { path: string; run: Effect.Effect<void> }

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly list: () => Effect.Effect<Resolved[]>
  readonly get: (name: string) => Effect.Effect<Resolved | undefined>
  readonly ensure: (target?: string) => Effect.Effect<void>
  readonly contains: (target?: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Reference") {}

export function referencePath(input: { directory: string; worktree: string; value: string }) {
  if (input.value.startsWith("~/")) return path.join(Global.Path.home, input.value.slice(2))
  return path.isAbsolute(input.value)
    ? input.value
    : path.resolve(input.worktree === "/" ? input.directory : input.worktree, input.value)
}

function resolveGit(
  input: { name: string; repository: string } | { name: string; repository: string; branch: string | undefined },
): Resolved {
  const parsed = parseRepositoryReference(input.repository)
  if (!parsed || parsed.protocol === "file:") {
    return {
      name: input.name,
      kind: "invalid",
      repository: input.repository,
      message: "Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand",
    }
  }
  return {
    name: input.name,
    kind: "git",
    repository: input.repository,
    reference: parsed,
    path: repositoryCachePath(parsed),
    ...("branch" in input ? { branch: input.branch } : {}),
  }
}

function branchLabel(branch: string | undefined) {
  return branch ?? "default branch"
}

function normalizedTarget(target?: string) {
  if (!target) return
  return process.platform === "win32" ? FSUtil.normalizePath(target) : target
}

function containsReferencePath(referencePath: string, target: string) {
  return FSUtil.contains(normalizedTarget(referencePath) ?? referencePath, target)
}

function uniqueGitReferences(references: Resolved[]) {
  const seenPath = new Set<string>()
  return references.filter((reference): reference is Extract<Resolved, { kind: "git" }> => {
    if (reference.kind !== "git") return false
    if (seenPath.has(reference.path)) return false
    seenPath.add(reference.path)
    return true
  })
}

function materializeReference(cache: RepositoryCache.Interface, reference: Extract<Resolved, { kind: "git" }>) {
  return cache.ensure({ reference: reference.reference, branch: reference.branch, refresh: true }).pipe(
    Effect.asVoid,
    Effect.catchCause((cause) =>
      Effect.logWarning("failed to materialize reference repository", { name: reference.name, cause }),
    ),
  )
}

const materializers = Effect.fn("Reference.materializers")(function* (
  cache: RepositoryCache.Interface,
  references: Resolved[],
) {
  return yield* Effect.forEach(
    uniqueGitReferences(references),
    Effect.fnUntraced(function* (reference) {
      return { path: reference.path, run: yield* Effect.cached(materializeReference(cache, reference)) }
    }),
    { concurrency: "unbounded" },
  )
})

function materializeAll(input: { flags: RuntimeFlags.Info; materializers: Materializer[] }) {
  if (!input.flags.experimentalReferences) return Effect.void
  return Effect.forEach(
    input.materializers,
    Effect.fnUntraced(function* (item) {
      yield* item.run
    }),
    { concurrency: 4, discard: true },
  )
}

function materializeByPath(materializers: Materializer[], target: string) {
  return materializers.find((item) => containsReferencePath(item.path, target))?.run ?? Effect.void
}

function containsGitReferencePath(references: Resolved[], target: string) {
  return references.some((reference) => reference.kind === "git" && containsReferencePath(reference.path, target))
}

export function resolve(input: {
  name: string
  reference: ConfigReference.NormalizedEntry
  directory: string
  worktree: string
}): Resolved {
  if (input.reference.kind === "invalid") {
    return { name: input.name, kind: "invalid", message: input.reference.message }
  }
  if (input.reference.kind === "local") {
    return { name: input.name, kind: "local", path: referencePath({ ...input, value: input.reference.path }) }
  }
  return resolveGit({ name: input.name, repository: input.reference.repository, branch: input.reference.branch })
}

export function resolveAll(input: { references: ConfigReference.NormalizedInfo; directory: string; worktree: string }) {
  const seen = new Map<string, { name: string; branch?: string }>()
  return Object.entries(input.references).map(([name, reference]) => {
    const resolved = resolve({ name, reference, directory: input.directory, worktree: input.worktree })
    if (resolved.kind !== "git") return resolved

    const existing = seen.get(resolved.path)
    if (!existing) {
      seen.set(resolved.path, { name, branch: resolved.branch })
      return resolved
    }
    if (existing.branch === resolved.branch) return resolved

    return {
      name,
      kind: "invalid" as const,
      repository: resolved.repository,
      message: `Reference conflicts with @${existing.name}: both use ${resolved.path}, but @${existing.name} requests ${branchLabel(existing.branch)} and @${name} requests ${branchLabel(resolved.branch)}`,
    }
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const cache = yield* RepositoryCache.Service
    const scope = yield* Scope.Scope
    const flags = yield* RuntimeFlags.Service

    const state = yield* InstanceState.make<State>(
      Effect.fn("Reference.state")(function* (ctx) {
        const cfg = yield* config.get()
        const references = resolveAll({
          references: ConfigReference.normalize(cfg.reference ?? {}),
          directory: ctx.directory,
          worktree: ctx.worktree,
        })
        const materializeByPath = yield* materializers(cache, references)
        const materializeAllCached = yield* Effect.cached(materializeAll({ flags, materializers: materializeByPath }))

        return { references, materializeAll: materializeAllCached, materializeByPath }
      }),
    )

    return Service.of({
      init: Effect.fn("Reference.init")(function* () {
        if (!flags.experimentalReferences) return
        yield* InstanceState.useEffect(state, (s) => s.materializeAll).pipe(Effect.forkIn(scope), Effect.asVoid)
      }),
      list: Effect.fn("Reference.list")(function* () {
        return yield* InstanceState.use(state, (s) => s.references)
      }),
      get: Effect.fn("Reference.get")(function* (name: string) {
        return yield* InstanceState.use(state, (s) => s.references.find((reference) => reference.name === name))
      }),
      ensure: Effect.fn("Reference.ensure")(function* (target?: string) {
        if (!flags.experimentalReferences) return
        const full = normalizedTarget(target)
        if (!full) return yield* InstanceState.useEffect(state, (s) => s.materializeAll)
        return yield* InstanceState.useEffect(state, (s) => materializeByPath(s.materializeByPath, full))
      }),
      contains: Effect.fn("Reference.contains")(function* (target?: string) {
        if (!flags.experimentalReferences) return false
        const full = normalizedTarget(target)
        if (!full) return false
        return yield* InstanceState.use(state, (s) => containsGitReferencePath(s.references, full))
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(RepositoryCache.defaultLayer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export * as Reference from "./reference"
