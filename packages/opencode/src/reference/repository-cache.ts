import path from "path"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Flock } from "@opencode-ai/core/util/flock"
import { Git } from "@/git"
import {
  repositoryCachePath,
  sameRepositoryReference,
  parseRepositoryReference,
  validateRepositoryBranch,
  type Reference as RepositoryReference,
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

export const ensure = Effect.fn("RepositoryCache.ensure")(function* (
  input: {
    reference: RepositoryReference
    refresh?: boolean
    branch?: string
  },
  services: {
    fs: AppFileSystem.Interface
    git: Git.Interface
  },
) {
  if (input.branch) validateRepositoryBranch(input.branch)

  const repository = input.reference.label
  const remote = input.reference.remote
  const localPath = repositoryCachePath(input.reference)
  const cloneTarget = parseRepositoryReference(remote) ?? input.reference

  return yield* Effect.acquireUseRelease(
    Effect.promise((signal) => Flock.acquire(`repo-clone:${localPath}`, { signal })),
    () =>
      Effect.gen(function* () {
        yield* services.fs.ensureDir(path.dirname(localPath)).pipe(Effect.orDie)

        const exists = yield* services.fs.existsSafe(localPath)
        const hasGitDir = yield* services.fs.existsSafe(path.join(localPath, ".git"))
        const origin = hasGitDir
          ? yield* services.git.run(["config", "--get", "remote.origin.url"], { cwd: localPath })
          : undefined
        const originReference = origin?.exitCode === 0 ? parseRepositoryReference(origin.text().trim()) : undefined
        const reuse = hasGitDir && Boolean(originReference && sameRepositoryReference(originReference, cloneTarget))
        if (exists && !reuse) {
          yield* services.fs.remove(localPath, { recursive: true }).pipe(Effect.orDie)
        }

        const currentBranch = hasGitDir ? yield* services.git.branch(localPath) : undefined
        const status = statusForRepository({
          reuse,
          refresh: input.refresh,
          branchMatches: input.branch ? currentBranch === input.branch : undefined,
        })

        if (status === "cloned") {
          const clone = yield* services.git.run(
            [
              "clone",
              "--depth",
              "100",
              ...(input.branch ? ["--branch", input.branch] : []),
              "--",
              remote,
              localPath,
            ],
            { cwd: path.dirname(localPath) },
          )
          if (clone.exitCode !== 0) {
            throw new Error(clone.stderr.toString().trim() || clone.text().trim() || `Failed to clone ${repository}`)
          }
        }

        if (status === "refreshed") {
          const fetch = yield* services.git.run(["fetch", "--all", "--prune"], { cwd: localPath })
          if (fetch.exitCode !== 0) {
            throw new Error(fetch.stderr.toString().trim() || fetch.text().trim() || `Failed to refresh ${repository}`)
          }

          if (input.branch) {
            const checkout = yield* services.git.run(["checkout", "-B", input.branch, `origin/${input.branch}`], {
              cwd: localPath,
            })
            if (checkout.exitCode !== 0) {
              throw new Error(
                checkout.stderr.toString().trim() || checkout.text().trim() || `Failed to checkout ${input.branch}`,
              )
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
            throw new Error(reset.stderr.toString().trim() || reset.text().trim() || `Failed to reset ${repository}`)
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

export * as RepositoryCache from "./repository-cache"
