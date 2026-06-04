export * as Git from "./git"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { AppProcess } from "./process"

export interface Repo {
  /**
   * The root directory of the working tree that contains the input path.
   *
   * For `/home/me/app/src/file.ts` in a normal clone, this is `/home/me/app`.
   * For `/home/me/app-feature/src/file.ts` in a linked worktree, this is
   * `/home/me/app-feature`.
   */
  readonly directory: AbsolutePath
  /**
   * The shared Git storage directory used by this repo and any linked worktrees.
   *
   * For a normal clone at `/home/me/app`, this is usually `/home/me/app/.git`.
   * For a linked worktree at `/home/me/app-feature` whose main checkout is
   * `/home/me/app`, this is usually `/home/me/app/.git`.
   */
  readonly store: AbsolutePath
}

export class WorktreeError extends Schema.TaggedErrorClass<WorktreeError>()("Git.WorktreeError", {
  operation: Schema.Literals(["create", "remove", "list"]),
  message: Schema.String,
  directory: Schema.optional(AbsolutePath),
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly find: (input: AbsolutePath) => Effect.Effect<Repo | undefined>
  readonly remote: (repo: Repo, name?: string) => Effect.Effect<string | undefined>
  readonly roots: (repo: Repo) => Effect.Effect<string[]>
  readonly origin: (directory: string) => Effect.Effect<string | undefined>
  readonly head: (directory: string) => Effect.Effect<string | undefined>
  readonly dir: (directory: string) => Effect.Effect<string | undefined>
  readonly branch: (directory: string) => Effect.Effect<string | undefined>
  readonly remoteHead: (directory: string) => Effect.Effect<string | undefined>
  readonly clone: (input: {
    remote: string
    target: string
    branch?: string
    depth?: number
  }) => Effect.Effect<Result, AppProcess.AppProcessError>
  readonly fetch: (directory: string) => Effect.Effect<Result, AppProcess.AppProcessError>
  readonly fetchBranch: (directory: string, branch: string) => Effect.Effect<Result, AppProcess.AppProcessError>
  readonly checkout: (directory: string, branch: string) => Effect.Effect<Result, AppProcess.AppProcessError>
  readonly reset: (directory: string, target: string) => Effect.Effect<Result, AppProcess.AppProcessError>
  readonly worktreeCreate: (input: { repo: Repo; directory: AbsolutePath }) => Effect.Effect<void, WorktreeError>
  readonly worktreeRemove: (input: { repo: Repo; directory: AbsolutePath }) => Effect.Effect<void, WorktreeError>
  readonly worktreeList: (repo: Repo) => Effect.Effect<AbsolutePath[], WorktreeError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/GitV2") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const proc = yield* AppProcess.Service

    const find = Effect.fn("Git.find")(function* (input: AbsolutePath) {
      const dotgit = yield* fs.up({ targets: [".git"], start: input }).pipe(
        Effect.map((matches) => matches[0]),
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (!dotgit) return undefined

      const cwd = path.dirname(dotgit)
      const git = run(cwd, proc)
      const topLevel = yield* git(["rev-parse", "--show-toplevel"])
      const commonDir = yield* git(["rev-parse", "--git-common-dir"])
      if (commonDir.exitCode !== 0) return undefined

      return {
        directory: AbsolutePath.make(topLevel.exitCode === 0 ? resolvePath(cwd, topLevel.text) : cwd),
        store: AbsolutePath.make(resolvePath(cwd, commonDir.text)),
      } satisfies Repo
    })

    const remote = Effect.fn("Git.remote")(function* (repo: Repo, name = "origin") {
      const result = yield* run(repo.directory, proc)(["remote", "get-url", name])
      if (result.exitCode !== 0) return undefined
      return result.text.trim() || undefined
    })

    const roots = Effect.fn("Git.roots")(function* (repo: Repo) {
      const result = yield* run(repo.directory, proc)(["rev-list", "--max-parents=0", "HEAD"])
      if (result.exitCode !== 0) return []
      return result.text
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
        .toSorted()
    })

    const origin = Effect.fn("Git.origin")(function* (directory: string) {
      const result = yield* run(directory, proc)(["config", "--get", "remote.origin.url"])
      if (result.exitCode !== 0) return undefined
      return result.text.trim() || undefined
    })

    const head = Effect.fn("Git.head")(function* (directory: string) {
      const result = yield* run(directory, proc)(["rev-parse", "HEAD"])
      if (result.exitCode !== 0) return undefined
      return result.text.trim() || undefined
    })

    const dir = Effect.fn("Git.dir")(function* (directory: string) {
      const result = yield* run(directory, proc)(["rev-parse", "--git-dir"])
      if (result.exitCode !== 0) return undefined
      return AbsolutePath.make(resolvePath(directory, result.text))
    })

    const branch = Effect.fn("Git.branch")(function* (directory: string) {
      const result = yield* run(directory, proc)(["symbolic-ref", "--quiet", "--short", "HEAD"])
      if (result.exitCode !== 0) return undefined
      return result.text.trim() || undefined
    })

    const remoteHead = Effect.fn("Git.remoteHead")(function* (directory: string) {
      const result = yield* run(directory, proc)(["symbolic-ref", "refs/remotes/origin/HEAD"])
      if (result.exitCode !== 0) return undefined
      return result.text.trim().replace(/^refs\/remotes\//, "") || undefined
    })

    const clone = Effect.fn("Git.clone")((input: { remote: string; target: string; branch?: string; depth?: number }) =>
      execute(
        path.dirname(input.target),
        proc,
      )([
        "clone",
        "--depth",
        String(input.depth ?? 100),
        ...(input.branch ? ["--branch", input.branch] : []),
        "--",
        input.remote,
        input.target,
      ]),
    )

    const fetch = Effect.fn("Git.fetch")((directory: string) => execute(directory, proc)(["fetch", "--all", "--prune"]))

    const fetchBranch = Effect.fn("Git.fetchBranch")((directory: string, branch: string) =>
      execute(directory, proc)(["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]),
    )

    const checkout = Effect.fn("Git.checkout")((directory: string, branch: string) =>
      execute(directory, proc)(["checkout", "-B", branch, `origin/${branch}`]),
    )

    const reset = Effect.fn("Git.reset")((directory: string, target: string) =>
      execute(directory, proc)(["reset", "--hard", target]),
    )

    const worktree = Effect.fnUntraced(function* (
      operation: "create" | "remove" | "list",
      repo: Repo,
      args: string[],
      worktreeDirectory?: AbsolutePath,
      cwd = repo.directory,
    ) {
      const result = yield* proc
        .run(ChildProcess.make("git", args, { cwd, extendEnv: true, stdin: "ignore" }))
        .pipe(
          Effect.mapError(
            (cause) => new WorktreeError({ operation, directory: worktreeDirectory, message: cause.message, cause }),
          ),
        )
      if (result.exitCode === 0) return result.stdout.toString("utf8")
      return yield* new WorktreeError({
        operation,
        directory: worktreeDirectory,
        message: result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim() || "Git failed",
      })
    })

    const worktreeCreate = Effect.fn("Git.worktreeCreate")(function* (input: { repo: Repo; directory: AbsolutePath }) {
      yield* worktree("create", input.repo, ["worktree", "add", "--detach", input.directory, "HEAD"], input.directory)
    })

    const worktreeRemove = Effect.fn("Git.worktreeRemove")(function* (input: { repo: Repo; directory: AbsolutePath }) {
      yield* worktree(
        "remove",
        input.repo,
        ["worktree", "remove", "--force", input.directory],
        input.directory,
        input.repo.store,
      )
    })

    const worktreeList = Effect.fn("Git.worktreeList")(function* (repo: Repo) {
      return (yield* worktree("list", repo, ["worktree", "list", "--porcelain"]))
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => AbsolutePath.make(resolvePath(repo.directory, line.slice("worktree ".length).trim())))
    })

    return Service.of({
      find,
      remote,
      roots,
      origin,
      head,
      dir,
      branch,
      remoteHead,
      clone,
      fetch,
      fetchBranch,
      checkout,
      reset,
      worktreeCreate,
      worktreeRemove,
      worktreeList,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer), Layer.provide(AppProcess.defaultLayer))

export interface Result {
  readonly exitCode: number
  readonly text: string
  readonly stderr: string
}

function run(cwd: string, proc: AppProcess.Interface) {
  return (args: string[]) =>
    execute(cwd, proc)(args).pipe(Effect.catch(() => Effect.succeed({ exitCode: 1, text: "", stderr: "" })))
}

function execute(cwd: string, proc: AppProcess.Interface) {
  return (args: string[]) =>
    proc
      .run(
        ChildProcess.make("git", args, {
          cwd,
          extendEnv: true,
          stdin: "ignore",
        }),
      )
      .pipe(
        Effect.map(
          (result) =>
            ({
              exitCode: result.exitCode,
              text: result.stdout.toString("utf8"),
              stderr: result.stderr.toString("utf8"),
            }) satisfies Result,
        ),
      )
}

function resolvePath(cwd: string, value: string) {
  const trimmed = value.replace(/[\r\n]+$/, "")
  if (!trimmed) return cwd
  const normalized = FSUtil.windowsPath(trimmed)
  if (path.isAbsolute(normalized)) return path.normalize(normalized)
  return path.resolve(cwd, normalized)
}
