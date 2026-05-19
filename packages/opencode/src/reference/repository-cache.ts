import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Flock } from "@opencode-ai/core/util/flock"
import { Git } from "@/git"
import {
  repositoryCachePath,
  sameRepositoryReference,
  parseRepositoryReference,
  validateRepositoryBranch,
  isRemoteRepositoryReference,
  type RemoteReference,
} from "@/util/repository"

export type Result = {
  repository: string
  host: string
  remote: string
  localPath: string
  status: "cached" | "cloned" | "refreshed"
  head?: string
  branch?: string
}

export type EnsureInput = {
  reference: RemoteReference
  refresh?: boolean
  branch?: string
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
  ensure: (input: EnsureInput) => Effect.Effect<Result, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RepositoryCache") {}

function statusForRepository(input: { reuse: boolean; refresh?: boolean; branchMatches?: boolean }) {
  if (!input.reuse) return "cloned" as const
  if (input.branchMatches === false) return "refreshed" as const
  if (input.refresh) return "refreshed" as const
  return "cached" as const
}

function resetTarget(input: {
  requestedBranch?: string
  remoteHead: { code: number; stdout: string }
  branch: { code: number; stdout: string }
}) {
  if (input.requestedBranch) return `origin/${input.requestedBranch}`
  if (input.remoteHead.code === 0 && input.remoteHead.stdout) {
    return input.remoteHead.stdout.replace(/^refs\/remotes\//, "")
  }
  if (input.branch.code === 0 && input.branch.stdout) {
    return `origin/${input.branch.stdout}`
  }
  return "HEAD"
}

function errorMessage(error: unknown) {
  return error instanceof globalThis.Error ? error.message : String(error)
}

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

export const parseRemoteReference = Effect.fn("RepositoryCache.parseRemoteReference")(function* (repository: string) {
  const reference = parseRepositoryReference(repository)
  if (!reference) {
    return yield* new InvalidRepositoryError({
      repository,
      message: "Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand",
    })
  }
  if (!isRemoteRepositoryReference(reference)) {
    return yield* new InvalidRepositoryError({ repository, message: "Local file repositories are not supported" })
  }
  return reference
})

export const validateBranch = Effect.fn("RepositoryCache.validateBranch")(function* (branch: string) {
  try {
    validateRepositoryBranch(branch)
  } catch (error) {
    return yield* new InvalidBranchError({ branch, message: errorMessage(error) })
  }
})

const ensureWithServices = Effect.fn("RepositoryCache.ensureWithServices")(function* (
  input: EnsureInput,
  services: {
    fs: AppFileSystem.Interface
    git: Git.Interface
  },
) {
  if (input.branch) yield* validateBranch(input.branch)

  const repository = input.reference.label
  const remote = input.reference.remote
  const localPath = repositoryCachePath(input.reference)
  const cloneTarget = parseRepositoryReference(remote) ?? input.reference

  return yield* Effect.acquireUseRelease(
    Effect.promise((signal) => Flock.acquire(`repo-clone:${localPath}`, { signal })).pipe(
      Effect.catch((error: unknown) =>
        Effect.fail(new LockFailedError({ localPath, message: errorMessage(error) || `Failed to lock ${localPath}` })),
      ),
    ),
    () =>
      Effect.gen(function* () {
        yield* services.fs.ensureDir(path.dirname(localPath)).pipe(
          Effect.catch((error: unknown) =>
            Effect.fail(
              new CacheOperationError({
                operation: "ensure cache directory",
                path: localPath,
                message: errorMessage(error),
              }),
            ),
          ),
        )

        const exists = yield* services.fs.existsSafe(localPath)
        const hasGitDir = yield* services.fs.existsSafe(path.join(localPath, ".git"))
        const origin = hasGitDir
          ? yield* services.git.run(["config", "--get", "remote.origin.url"], { cwd: localPath })
          : undefined
        const originReference = origin?.exitCode === 0 ? parseRepositoryReference(origin.text().trim()) : undefined
        const reuse = hasGitDir && Boolean(originReference && sameRepositoryReference(originReference, cloneTarget))
        if (exists && !reuse) {
          yield* services.fs.remove(localPath, { recursive: true }).pipe(
            Effect.catch((error: unknown) =>
              Effect.fail(
                new CacheOperationError({
                  operation: "remove stale cache",
                  path: localPath,
                  message: errorMessage(error),
                }),
              ),
            ),
          )
        }

        const currentBranch = hasGitDir ? yield* services.git.branch(localPath) : undefined
        const status = statusForRepository({
          reuse,
          refresh: input.refresh,
          branchMatches: input.branch ? currentBranch === input.branch : undefined,
        })

        if (status === "cloned") {
          const clone = yield* services.git.run(
            ["clone", "--depth", "100", ...(input.branch ? ["--branch", input.branch] : []), "--", remote, localPath],
            { cwd: path.dirname(localPath) },
          )
          if (clone.exitCode !== 0) {
            return yield* new CloneFailedError({
              repository,
              message: clone.stderr.toString().trim() || clone.text().trim() || `Failed to clone ${repository}`,
            })
          }
        }

        if (status === "refreshed") {
          const fetch = yield* services.git.run(["fetch", "--all", "--prune"], { cwd: localPath })
          if (fetch.exitCode !== 0) {
            return yield* new FetchFailedError({
              repository,
              message: fetch.stderr.toString().trim() || fetch.text().trim() || `Failed to refresh ${repository}`,
            })
          }

          if (input.branch) {
            const checkout = yield* services.git.run(["checkout", "-B", input.branch, `origin/${input.branch}`], {
              cwd: localPath,
            })
            if (checkout.exitCode !== 0) {
              return yield* new CheckoutFailedError({
                repository,
                branch: input.branch,
                message:
                  checkout.stderr.toString().trim() || checkout.text().trim() || `Failed to checkout ${input.branch}`,
              })
            }
          }

          const remoteHead = yield* services.git.run(["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: localPath })
          const branch = yield* services.git.run(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: localPath })
          const target = resetTarget({
            requestedBranch: input.branch,
            remoteHead: { code: remoteHead.exitCode, stdout: remoteHead.text().trim() },
            branch: { code: branch.exitCode, stdout: branch.text().trim() },
          })

          const reset = yield* services.git.run(["reset", "--hard", target], { cwd: localPath })
          if (reset.exitCode !== 0) {
            return yield* new ResetFailedError({
              repository,
              message: reset.stderr.toString().trim() || reset.text().trim() || `Failed to reset ${repository}`,
            })
          }
        }

        const head = yield* services.git.run(["rev-parse", "HEAD"], { cwd: localPath })
        const branch = yield* services.git.branch(localPath)
        const headText = head.exitCode === 0 ? head.text().trim() : undefined

        return {
          repository,
          host: input.reference.host,
          remote,
          localPath,
          status,
          head: headText,
          branch,
        } satisfies Result
      }),
    (lock) => Effect.promise(() => lock.release()).pipe(Effect.ignore),
  )
})

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Git.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const git = yield* Git.Service

    return Service.of({
      ensure: Effect.fn("RepositoryCache.ensure")(function* (input) {
        return yield* ensureWithServices(input, { fs, git })
      }),
    })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Git.defaultLayer),
)

export * as RepositoryCache from "./repository-cache"
