import path from "path"
import { Effect, Context, Layer, Scope } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Git } from "@/git"
import { parseRepositoryReference, repositoryCachePath, type Reference as RepositoryReference } from "@/util/repository"
import { RepositoryCache } from "./repository-cache"

type ReferenceEntry = NonNullable<Config.Info["reference"]>[string]

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
      reference: RepositoryReference
      path: string
      branch?: string
    }
  | {
      name: string
      kind: "invalid"
      repository: string
      message: string
    }

type State = {
  references: Resolved[]
  materializeAll: Effect.Effect<void>
  materializeByPath: { path: string; run: Effect.Effect<void> }[]
}

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
  return process.platform === "win32" ? AppFileSystem.normalizePath(target) : target
}

function containsReferencePath(referencePath: string, target: string) {
  return AppFileSystem.contains(normalizedTarget(referencePath) ?? referencePath, target)
}

export function resolve(input: {
  name: string
  reference: ReferenceEntry
  directory: string
  worktree: string
}): Resolved {
  if (typeof input.reference === "string") {
    if (input.reference.startsWith(".") || input.reference.startsWith("/") || input.reference.startsWith("~")) {
      return { name: input.name, kind: "local", path: referencePath({ ...input, value: input.reference }) }
    }
    return resolveGit({ name: input.name, repository: input.reference })
  }

  if ("path" in input.reference) {
    return { name: input.name, kind: "local", path: referencePath({ ...input, value: input.reference.path }) }
  }

  return resolveGit({ name: input.name, repository: input.reference.repository, branch: input.reference.branch })
}

export function resolveAll(input: {
  references: NonNullable<Config.Info["reference"]>
  directory: string
  worktree: string
}) {
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
    const fs = yield* AppFileSystem.Service
    const git = yield* Git.Service
    const scope = yield* Scope.Scope

    const state = yield* InstanceState.make<State>(
      Effect.fn("Reference.state")(function* (ctx) {
        const cfg = yield* config.get()
        const references = resolveAll({
          references: cfg.reference ?? {},
          directory: ctx.directory,
          worktree: ctx.worktree,
        })
        const seenPath = new Set<string>()
        const gitReferences = references.filter((reference): reference is Extract<Resolved, { kind: "git" }> => {
          if (reference.kind !== "git") return false
          if (seenPath.has(reference.path)) return false
          seenPath.add(reference.path)
          return true
        })
        const materializeByPath = yield* Effect.forEach(
          gitReferences,
          Effect.fnUntraced(function* (reference) {
            const run = yield* Effect.cached(
              RepositoryCache.ensure(
                { reference: reference.reference, branch: reference.branch, refresh: true },
                { fs, git },
              ).pipe(
                Effect.asVoid,
                Effect.catchCause((cause) =>
                  Effect.logWarning("failed to materialize reference repository", { name: reference.name, cause }),
                ),
              ),
            )
            return { path: reference.path, run }
          }),
          { concurrency: "unbounded" },
        )

        const materializeAll = yield* Effect.cached(
          Flag.OPENCODE_EXPERIMENTAL_SCOUT
            ? Effect.gen(function* () {
                yield* Effect.forEach(
                  materializeByPath,
                  Effect.fnUntraced(function* (item) {
                    yield* item.run
                  }),
                  { concurrency: 4, discard: true },
                )
              })
            : Effect.void,
        )

        return { references, materializeAll, materializeByPath }
      }),
    )

    return Service.of({
      init: Effect.fn("Reference.init")(function* () {
        if (!Flag.OPENCODE_EXPERIMENTAL_SCOUT) return
        yield* InstanceState.useEffect(state, (s) => s.materializeAll).pipe(Effect.forkIn(scope), Effect.asVoid)
      }),
      list: Effect.fn("Reference.list")(function* () {
        return yield* InstanceState.use(state, (s) => s.references)
      }),
      get: Effect.fn("Reference.get")(function* (name: string) {
        return yield* InstanceState.use(state, (s) => s.references.find((reference) => reference.name === name))
      }),
      ensure: Effect.fn("Reference.ensure")(function* (target?: string) {
        if (!Flag.OPENCODE_EXPERIMENTAL_SCOUT) return
        const full = normalizedTarget(target)
        if (!full) return yield* InstanceState.useEffect(state, (s) => s.materializeAll)
        return yield* InstanceState.useEffect(
          state,
          (s) => s.materializeByPath.find((item) => containsReferencePath(item.path, full))?.run ?? Effect.void,
        )
      }),
      contains: Effect.fn("Reference.contains")(function* (target?: string) {
        if (!Flag.OPENCODE_EXPERIMENTAL_SCOUT) return false
        const full = normalizedTarget(target)
        if (!full) return false
        return yield* InstanceState.use(state, (s) =>
          s.references.some((reference) => reference.kind === "git" && containsReferencePath(reference.path, full)),
        )
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Git.defaultLayer),
)

export * as Reference from "./reference"
