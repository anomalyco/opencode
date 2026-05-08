import path from "path"
import { Effect, Schema } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Flock } from "@opencode-ai/core/util/flock"
import { Git } from "@/git"
import DESCRIPTION from "./repo_clone.txt"
import * as Tool from "./tool"
import { parseRepositoryReference, repositoryCachePath, sameRepositoryReference } from "@/util/repository"

export const Parameters = Schema.Struct({
  repository: Schema.String.annotate({
    description: "Repository to clone, as a git URL, host/path reference, or GitHub owner/repo shorthand",
  }),
  refresh: Schema.optional(Schema.Boolean).annotate({
    description: "When true, fetches the latest remote state into the managed cache",
  }),
  branch: Schema.optional(Schema.String).annotate({
    description: "Branch or ref to clone and inspect",
  }),
})

type Metadata = {
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

function validateBranch(branch: string) {
  if (!/^[A-Za-z0-9/_.-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..")) {
    throw new Error(
      "Branch must contain only alphanumeric characters, /, _, ., and -, and cannot start with - or contain ..",
    )
  }
}

export const RepoCloneTool = Tool.define<typeof Parameters, Metadata, AppFileSystem.Service | Git.Service>(
  "repo_clone",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const git = yield* Git.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const reference = parseRepositoryReference(params.repository)
          if (!reference)
            throw new Error("Repository must be a git URL, host/path reference, or GitHub owner/repo shorthand")
          if (reference.protocol === "file:") throw new Error("Local file repositories are not supported")
          if (params.branch) validateBranch(params.branch)

          const repository = reference.label
          const remote = reference.remote
          const localPath = repositoryCachePath(reference)
          const cloneTarget = parseRepositoryReference(remote) ?? reference

          yield* ctx.ask({
            permission: "repo_clone",
            patterns: [repository],
            always: [repository],
            metadata: {
              repository,
              remote,
              path: localPath,
              refresh: Boolean(params.refresh),
              branch: params.branch,
            },
          })

          return yield* Effect.acquireUseRelease(
            Effect.promise((signal) => Flock.acquire(`repo-clone:${localPath}`, { signal })),
            () =>
              Effect.gen(function* () {
                yield* fs.ensureDir(path.dirname(localPath)).pipe(Effect.orDie)

                const exists = yield* fs.existsSafe(localPath)
                const hasGitDir = yield* fs.existsSafe(path.join(localPath, ".git"))
                const origin = hasGitDir
                  ? yield* git.run(["config", "--get", "remote.origin.url"], { cwd: localPath })
                  : undefined
                const originReference =
                  origin?.exitCode === 0 ? parseRepositoryReference(origin.text().trim()) : undefined
                const reuse =
                  hasGitDir && Boolean(originReference && sameRepositoryReference(originReference, cloneTarget))
                if (exists && !reuse) {
                  yield* fs.remove(localPath, { recursive: true }).pipe(Effect.orDie)
                }

                const currentBranch = hasGitDir ? yield* git.branch(localPath) : undefined
                const status = statusForRepository({
                  reuse,
                  refresh: params.refresh,
                  branchMatches: params.branch ? currentBranch === params.branch : undefined,
                })

                if (status === "cloned") {
                  const clone = yield* git.run(
                    [
                      "clone",
                      "--depth",
                      "100",
                      ...(params.branch ? ["--branch", params.branch] : []),
                      "--",
                      remote,
                      localPath,
                    ],
                    { cwd: path.dirname(localPath) },
                  )
                  if (clone.exitCode !== 0) {
                    throw new Error(
                      clone.stderr.toString().trim() || clone.text().trim() || `Failed to clone ${repository}`,
                    )
                  }
                }

                if (status === "refreshed") {
                  const fetch = yield* git.run(["fetch", "--all", "--prune"], { cwd: localPath })
                  if (fetch.exitCode !== 0) {
                    throw new Error(
                      fetch.stderr.toString().trim() || fetch.text().trim() || `Failed to refresh ${repository}`,
                    )
                  }

                  if (params.branch) {
                    const checkout = yield* git.run(["checkout", "-B", params.branch, `origin/${params.branch}`], {
                      cwd: localPath,
                    })
                    if (checkout.exitCode !== 0) {
                      throw new Error(
                        checkout.stderr.toString().trim() ||
                          checkout.text().trim() ||
                          `Failed to checkout ${params.branch}`,
                      )
                    }
                  }

                  const remoteHead = yield* git.run(["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: localPath })
                  const branch = yield* git.run(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd: localPath })
                  const target = resetTarget({
                    requestedBranch: params.branch,
                    remoteHead: { code: remoteHead.exitCode, stdout: remoteHead.text().trim() },
                    branch: { code: branch.exitCode, stdout: branch.text().trim() },
                  })

                  const reset = yield* git.run(["reset", "--hard", target], { cwd: localPath })
                  if (reset.exitCode !== 0) {
                    throw new Error(
                      reset.stderr.toString().trim() || reset.text().trim() || `Failed to reset ${repository}`,
                    )
                  }
                }

                const head = yield* git.run(["rev-parse", "HEAD"], { cwd: localPath })
                const branch = yield* git.branch(localPath)
                const headText = head.exitCode === 0 ? head.text().trim() : undefined

                return {
                  title: repository,
                  metadata: {
                    repository,
                    host: reference.host,
                    remote,
                    localPath,
                    status,
                    head: headText,
                    branch,
                  },
                  output: [
                    `Repository ready: ${repository}`,
                    `Status: ${status}`,
                    `Local path: ${localPath}`,
                    ...(branch ? [`Branch: ${branch}`] : []),
                    ...(headText ? [`HEAD: ${headText}`] : []),
                  ].join("\n"),
                }
              }),
            (lock) => Effect.promise(() => lock.release()).pipe(Effect.ignore),
          )
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)
