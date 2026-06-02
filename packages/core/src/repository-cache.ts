import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppFileSystem } from "./filesystem"
import { Global } from "./global"
import { AppProcess } from "./process"
import { Repository } from "./repository"
import { EffectFlock } from "./util/effect-flock"

export type Result = {
  readonly repository: string
  readonly host: string
  readonly remote: string
  readonly localPath: string
  readonly status: "cached" | "cloned" | "refreshed"
  readonly head?: string
  readonly branch?: string
}

export type EnsureInput = {
  readonly reference: Repository.RemoteReference
  readonly refresh?: boolean
  readonly branch?: string
}

export class InvalidRepositoryError extends Schema.TaggedErrorClass<InvalidRepositoryError>()(
  "RepositoryCacheInvalidRepositoryError",
  {
    repository: Schema.String,
    message: Schema.String,
  },
) {}

export class InvalidBranchError extends Schema.TaggedErrorClass<InvalidBranchError>()("RepositoryCacheInvalidBranchError", {
  branch: Schema.String,
  message: Schema.String,
}) {}

export class CloneFailedError extends Schema.TaggedErrorClass<CloneFailedError>()("RepositoryCacheCloneFailedError", {
  repository: Schema.String,
  message: Schema.String,
}) {}

export class FetchFailedError extends Schema.TaggedErrorClass<FetchFailedError>()("RepositoryCacheFetchFailedError", {
  repository: Schema.String,
  message: Schema.String,
}) {}

export class CheckoutFailedError extends Schema.TaggedErrorClass<CheckoutFailedError>()(
  "RepositoryCacheCheckoutFailedError",
  {
    repository: Schema.String,
    branch: Schema.String,
    message: Schema.String,
  },
) {}

export class ResetFailedError extends Schema.TaggedErrorClass<ResetFailedError>()("RepositoryCacheResetFailedError", {
  repository: Schema.String,
  message: Schema.String,
}) {}

export class LockFailedError extends Schema.TaggedErrorClass<LockFailedError>()("RepositoryCacheLockFailedError", {
  localPath: Schema.String,
  message: Schema.String,
}) {}

export class CacheOperationError extends Schema.TaggedErrorClass<CacheOperationError>()("RepositoryCacheOperationError", {
  operation: Schema.String,
  path: Schema.String,
  message: Schema.String,
}) {}

export type Error =
  | InvalidRepositoryError
  | InvalidBranchError
  | CloneFailedError
  | FetchFailedError
  | CheckoutFailedError
  | ResetFailedError
  | LockFailedError
  | CacheOperationError

export interface Interface {
  readonly ensure: (input: EnsureInput) => Effect.Effect<Result, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RepositoryCache") {}

export function isError(error: unknown): error is Error {
  return (
    error instanceof InvalidRepositoryError ||
    error instanceof InvalidBranchError ||
    error instanceof CloneFailedError ||
    error instanceof FetchFailedError ||
    error instanceof CheckoutFailedError ||
    error instanceof ResetFailedError ||
    error instanceof LockFailedError ||
    error instanceof CacheOperationError
  )
}

export const parseRemote = Effect.fn("RepositoryCache.parseRemote")(function* (repository: string) {
  return yield* Effect.try({
    try: () => Repository.parseRemote(repository),
    catch: (error) => new InvalidRepositoryError({ repository, message: errorMessage(error) }),
  })
})

export const validateBranch = Effect.fn("RepositoryCache.validateBranch")(function* (branch: string) {
  return yield* Effect.try({
    try: () => Repository.validateBranch(branch),
    catch: (error) => new InvalidBranchError({ branch, message: errorMessage(error) }),
  })
})

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | AppProcess.Service | EffectFlock.Service | Global.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const proc = yield* AppProcess.Service
    const flock = yield* EffectFlock.Service
    const global = yield* Global.Service

    return Service.of({
      ensure: Effect.fn("RepositoryCache.ensure")(function* (input) {
        if (input.branch) yield* validateBranch(input.branch)

        const repository = input.reference.label
        const localPath = Repository.cachePath(global.repos, input.reference)
        const cloneTarget = Repository.parse(input.reference.remote) ?? input.reference

        return yield* flock
          .withLock(
            Effect.gen(function* () {
              yield* cacheOperation(fs.ensureDir(path.dirname(localPath)), "ensure cache directory", localPath)

              const exists = yield* fs.existsSafe(localPath)
              const hasGitDir = yield* fs.existsSafe(path.join(localPath, ".git"))
              const origin = hasGitDir ? yield* gitSafe(proc, localPath, ["config", "--get", "remote.origin.url"]) : undefined
              const originReference = origin?.exitCode === 0 ? Repository.parse(origin.stdout.trim()) : undefined
              const reuse = hasGitDir && Boolean(originReference && Repository.same(originReference, cloneTarget))
              if (exists && !reuse) {
                yield* cacheOperation(fs.remove(localPath, { recursive: true }), "remove stale cache", localPath)
              }

              const currentBranch = reuse ? yield* branch(proc, localPath) : undefined
              const status = statusForRepository({
                reuse,
                refresh: input.refresh,
                branchMatches: input.branch ? currentBranch === input.branch : undefined,
              })

              if (status === "cloned") {
                const result = yield* git(proc, path.dirname(localPath), [
                  "clone",
                  "--depth",
                  "100",
                  ...(input.branch ? ["--branch", input.branch] : []),
                  "--",
                  input.reference.remote,
                  localPath,
                ]).pipe(
                  Effect.mapError((error) => new CloneFailedError({ repository, message: errorMessage(error) })),
                )
                if (result.exitCode !== 0) {
                  return yield* new CloneFailedError({ repository, message: resultMessage(result, `Failed to clone ${repository}`) })
                }
              }

              if (status === "refreshed") {
                const fetch = yield* git(proc, localPath, ["fetch", "--all", "--prune"]).pipe(
                  Effect.mapError((error) => new FetchFailedError({ repository, message: errorMessage(error) })),
                )
                if (fetch.exitCode !== 0) {
                  return yield* new FetchFailedError({ repository, message: resultMessage(fetch, `Failed to refresh ${repository}`) })
                }

                if (input.branch) {
                  const requestedBranch = input.branch
                  const fetchBranch = yield* git(proc, localPath, [
                    "fetch",
                    "origin",
                    `+refs/heads/${requestedBranch}:refs/remotes/origin/${requestedBranch}`,
                  ]).pipe(
                    Effect.mapError((error) => new FetchFailedError({ repository, message: errorMessage(error) })),
                  )
                  if (fetchBranch.exitCode !== 0) {
                    return yield* new FetchFailedError({
                      repository,
                      message: resultMessage(fetchBranch, `Failed to fetch ${requestedBranch}`),
                    })
                  }

                  const checkout = yield* git(proc, localPath, ["checkout", "-B", requestedBranch, `origin/${requestedBranch}`]).pipe(
                    Effect.mapError((error) =>
                      new CheckoutFailedError({ repository, branch: requestedBranch, message: errorMessage(error) }),
                    ),
                  )
                  if (checkout.exitCode !== 0) {
                    return yield* new CheckoutFailedError({
                      repository,
                      branch: requestedBranch,
                      message: resultMessage(checkout, `Failed to checkout ${requestedBranch}`),
                    })
                  }
                }

                const reset = yield* git(proc, localPath, ["reset", "--hard", yield* resetTarget(proc, localPath, input.branch)]).pipe(
                  Effect.mapError((error) => new ResetFailedError({ repository, message: errorMessage(error) })),
                )
                if (reset.exitCode !== 0) {
                  return yield* new ResetFailedError({ repository, message: resultMessage(reset, `Failed to reset ${repository}`) })
                }
              }

              const head = yield* gitSafe(proc, localPath, ["rev-parse", "HEAD"])
              return {
                repository,
                host: input.reference.host,
                remote: input.reference.remote,
                localPath,
                status,
                head: head?.exitCode === 0 ? head.stdout.trim() || undefined : undefined,
                branch: yield* branch(proc, localPath),
              } satisfies Result
            }),
            `repository-cache:${localPath}`,
          )
          .pipe(
            Effect.mapError((error) =>
              isError(error) ? error : new LockFailedError({ localPath, message: errorMessage(error) }),
            ),
          )
      }),
    })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(EffectFlock.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(AppProcess.defaultLayer),
  Layer.provide(Global.defaultLayer),
)

function statusForRepository(input: { reuse: boolean; refresh?: boolean; branchMatches?: boolean }) {
  if (!input.reuse) return "cloned" as const
  if (input.branchMatches === false || input.refresh) return "refreshed" as const
  return "cached" as const
}

function errorMessage(error: unknown) {
  return error instanceof globalThis.Error ? error.message : String(error)
}

function cacheOperation<A, E, R>(effect: Effect.Effect<A, E, R>, operation: string, target: string) {
  return effect.pipe(Effect.mapError((error) => new CacheOperationError({ operation, path: target, message: errorMessage(error) })))
}

function git(proc: AppProcess.Interface, cwd: string, args: string[]) {
  return proc.run(
    ChildProcess.make("git", args, {
      cwd,
      extendEnv: true,
      stdin: "ignore",
    }),
  ).pipe(
    Effect.map((result) => ({
      exitCode: result.exitCode,
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr.toString("utf8"),
    })),
  )
}

function gitSafe(proc: AppProcess.Interface, cwd: string, args: string[]) {
  return git(proc, cwd, args).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function branch(proc: AppProcess.Interface, cwd: string) {
  return gitSafe(proc, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]).pipe(
    Effect.map((result) => (result?.exitCode === 0 ? result.stdout.trim() || undefined : undefined)),
  )
}

const resetTarget = Effect.fnUntraced(function* (proc: AppProcess.Interface, cwd: string, requestedBranch?: string) {
  if (requestedBranch) return `origin/${requestedBranch}`
  const remoteHead = yield* gitSafe(proc, cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"])
  if (remoteHead?.exitCode === 0 && remoteHead.stdout.trim()) return remoteHead.stdout.trim().replace(/^refs\/remotes\//, "")
  const currentBranch = yield* branch(proc, cwd)
  if (currentBranch) return `origin/${currentBranch}`
  return "HEAD"
})

function resultMessage(result: { stderr: string; stdout: string }, fallback: string) {
  return result.stderr.trim() || result.stdout.trim() || fallback
}

export * as RepositoryCache from "./repository-cache"
