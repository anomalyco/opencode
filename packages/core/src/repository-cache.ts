import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { FSUtil } from "./fs-util"
import { Git } from "./git"
import { Global } from "./global"
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

export class InvalidBranchError extends Schema.TaggedErrorClass<InvalidBranchError>()(
  "RepositoryCacheInvalidBranchError",
  {
    branch: Schema.String,
    message: Schema.String,
  },
) {}

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

export class CacheOperationError extends Schema.TaggedErrorClass<CacheOperationError>()(
  "RepositoryCacheOperationError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

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

export const layer: Layer.Layer<Service, never, FSUtil.Service | Git.Service | EffectFlock.Service | Global.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const git = yield* Git.Service
      const flock = yield* EffectFlock.Service
      const global = yield* Global.Service

      return Service.of({
        ensure: Effect.fn("RepositoryCache.ensure")(function* (input) {
          if (input.branch) yield* validateBranch(input.branch)
          const requestedRef = input.branch ? parseRequestedRef(input.branch) : undefined

          const repository = input.reference.label
          const localPath = Repository.cachePath(global.repos, input.reference)
          const cloneTarget = Repository.parse(input.reference.remote) ?? input.reference

          return yield* flock
            .withLock(
              Effect.gen(function* () {
                yield* cacheOperation(fs.ensureDir(path.dirname(localPath)), "ensure cache directory", localPath)

                const exists = yield* fs.existsSafe(localPath)
                const hasGitDir = yield* fs.existsSafe(path.join(localPath, ".git"))
                const origin = hasGitDir ? yield* git.origin(localPath) : undefined
                const originReference = origin ? Repository.parse(origin) : undefined
                const reuse = hasGitDir && Boolean(originReference && Repository.same(originReference, cloneTarget))
                if (exists && !reuse) {
                  yield* cacheOperation(fs.remove(localPath, { recursive: true }), "remove stale cache", localPath)
                }

                const currentBranch = reuse ? yield* git.branch(localPath) : undefined
                const status = statusForRepository({
                  reuse,
                  refresh: input.refresh,
                  branchMatches: requestedRef ? refMatchesCurrentBranch(requestedRef, currentBranch) : undefined,
                })

                if (status === "cloned") {
                  const result = yield* git
                    .clone({ remote: input.reference.remote, target: localPath, branch: cloneBranchFor(requestedRef) })
                    .pipe(
                      Effect.mapError((error) => new CloneFailedError({ repository, message: errorMessage(error) })),
                    )
                  if (result.exitCode !== 0) {
                    return yield* new CloneFailedError({
                      repository,
                      message: resultMessage(result, `Failed to clone ${repository}`),
                    })
                  }
                }

                if (status === "refreshed") {
                  const fetch = yield* git
                    .fetch(localPath)
                    .pipe(
                      Effect.mapError((error) => new FetchFailedError({ repository, message: errorMessage(error) })),
                    )
                  if (fetch.exitCode !== 0) {
                    return yield* new FetchFailedError({
                      repository,
                      message: resultMessage(fetch, `Failed to refresh ${repository}`),
                    })
                  }
                }

                if (
                  requestedRef &&
                  (status === "refreshed" ||
                    (status === "cloned" && (requestedRef.type === "tag" || requestedRef.type === "full")))
                ) {
                  yield* syncRequestedRef(git, localPath, repository, requestedRef)
                }

                if (status === "refreshed" && !requestedRef) {
                  const reset = yield* git
                    .reset(localPath, yield* resetTarget(git, localPath))
                    .pipe(
                      Effect.mapError((error) => new ResetFailedError({ repository, message: errorMessage(error) })),
                    )
                  if (reset.exitCode !== 0) {
                    return yield* new ResetFailedError({
                      repository,
                      message: resultMessage(reset, `Failed to reset ${repository}`),
                    })
                  }
                }

                return {
                  repository,
                  host: input.reference.host,
                  remote: input.reference.remote,
                  localPath,
                  status,
                  head: yield* git.head(localPath),
                  branch: yield* git.branch(localPath),
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
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(Git.defaultLayer),
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
  return effect.pipe(
    Effect.mapError((error) => new CacheOperationError({ operation, path: target, message: errorMessage(error) })),
  )
}

type RequestedRef =
  | { readonly type: "branch"; readonly input: string; readonly name: string }
  | { readonly type: "tag"; readonly input: string; readonly name: string }
  | { readonly type: "full"; readonly input: string; readonly source: string; readonly destination: string }
  | { readonly type: "named"; readonly input: string; readonly name: string }

function parseRequestedRef(input: string): RequestedRef {
  const branch = removePrefix(input, "refs/heads/")
  if (branch) return { type: "branch", input, name: branch }

  const tag = removePrefix(input, "refs/tags/")
  if (tag) return { type: "tag", input, name: tag }

  if (input.startsWith("refs/")) {
    return { type: "full", input, source: input, destination: `refs/opencode/${input.slice("refs/".length)}` }
  }

  return { type: "named", input, name: input }
}

function removePrefix(input: string, prefix: string) {
  if (!input.startsWith(prefix)) return
  const value = input.slice(prefix.length)
  return value || undefined
}

function refMatchesCurrentBranch(ref: RequestedRef, currentBranch: string | undefined) {
  if (ref.type === "branch" || ref.type === "named") return currentBranch === ref.name
  return false
}

function cloneBranchFor(ref: RequestedRef | undefined) {
  if (!ref || ref.type === "tag" || ref.type === "full") return
  return ref.name
}

const syncRequestedRef = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  repository: string,
  requested: RequestedRef,
) {
  if (requested.type === "branch") {
    const fetch = yield* git
      .fetchBranch(cwd, requested.name)
      .pipe(Effect.mapError((error) => new FetchFailedError({ repository, message: errorMessage(error) })))
    if (fetch.exitCode !== 0) {
      return yield* new FetchFailedError({
        repository,
        message: resultMessage(fetch, `Failed to fetch ${requested.input}`),
      })
    }
    return yield* checkoutBranchRef(git, cwd, repository, requested.input, requested.name)
  }

  if (requested.type === "tag") {
    const target = tagRef(requested.name)
    const fetch = yield* git
      .fetchRef(cwd, target, target)
      .pipe(Effect.mapError((error) => new FetchFailedError({ repository, message: errorMessage(error) })))
    if (fetch.exitCode !== 0) {
      return yield* new FetchFailedError({
        repository,
        message: resultMessage(fetch, `Failed to fetch ${requested.input}`),
      })
    }
    return yield* checkoutDetachedRef(git, cwd, repository, requested.input, target)
  }

  if (requested.type === "full") {
    const fetch = yield* git
      .fetchRef(cwd, requested.source, requested.destination)
      .pipe(Effect.mapError((error) => new FetchFailedError({ repository, message: errorMessage(error) })))
    if (fetch.exitCode !== 0) {
      return yield* new FetchFailedError({
        repository,
        message: resultMessage(fetch, `Failed to fetch ${requested.input}`),
      })
    }
    return yield* checkoutDetachedRef(git, cwd, repository, requested.input, requested.destination)
  }

  const branchFetch = yield* git
    .fetchBranch(cwd, requested.name)
    .pipe(Effect.mapError((error) => new FetchFailedError({ repository, message: errorMessage(error) })))
  if (branchFetch.exitCode === 0) {
    return yield* checkoutBranchRef(git, cwd, repository, requested.input, requested.name)
  }

  const target = tagRef(requested.name)
  const tagFetch = yield* git
    .fetchRef(cwd, target, target)
    .pipe(Effect.mapError((error) => new FetchFailedError({ repository, message: errorMessage(error) })))
  if (tagFetch.exitCode === 0) return yield* checkoutDetachedRef(git, cwd, repository, requested.input, target)

  return yield* new FetchFailedError({
    repository,
    message: resultMessage(tagFetch, resultMessage(branchFetch, `Failed to fetch ${requested.input}`)),
  })
})

const checkoutBranchRef = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  repository: string,
  input: string,
  branch: string,
) {
  const checkout = yield* git.checkout(cwd, branch).pipe(
    Effect.mapError((error) => new CheckoutFailedError({ repository, branch: input, message: errorMessage(error) })),
  )
  if (checkout.exitCode !== 0) {
    return yield* new CheckoutFailedError({
      repository,
      branch: input,
      message: resultMessage(checkout, `Failed to checkout ${input}`),
    })
  }

  return yield* resetToTarget(git, cwd, repository, `origin/${branch}`)
})

const checkoutDetachedRef = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  repository: string,
  input: string,
  target: string,
) {
  const checkout = yield* git.checkoutRef(cwd, target).pipe(
    Effect.mapError((error) => new CheckoutFailedError({ repository, branch: input, message: errorMessage(error) })),
  )
  if (checkout.exitCode !== 0) {
    return yield* new CheckoutFailedError({
      repository,
      branch: input,
      message: resultMessage(checkout, `Failed to checkout ${input}`),
    })
  }

  return yield* resetToTarget(git, cwd, repository, target)
})

const resetToTarget = Effect.fnUntraced(function* (git: Git.Interface, cwd: string, repository: string, target: string) {
  const reset = yield* git
    .reset(cwd, target)
    .pipe(Effect.mapError((error) => new ResetFailedError({ repository, message: errorMessage(error) })))
  if (reset.exitCode !== 0) {
    return yield* new ResetFailedError({
      repository,
      message: resultMessage(reset, `Failed to reset ${repository}`),
    })
  }
})

function tagRef(tag: string) {
  return `refs/tags/${tag}`
}

const resetTarget = Effect.fnUntraced(function* (git: Git.Interface, cwd: string) {
  const remoteHead = yield* git.remoteHead(cwd)
  if (remoteHead) return remoteHead
  const currentBranch = yield* git.branch(cwd)
  if (currentBranch) return `origin/${currentBranch}`
  return "HEAD"
})

function resultMessage(result: Git.Result, fallback: string) {
  return result.stderr.trim() || result.text.trim() || fallback
}

export * as RepositoryCache from "./repository-cache"
