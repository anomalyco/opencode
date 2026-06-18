export * as Git from "./git"

import path from "path"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AbsolutePath } from "./schema"
import { FSUtil } from "./fs-util"
import { AppProcess } from "./process"
import { LayerNode } from "./effect/layer-node"

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
  forceRequired: Schema.optional(Schema.Boolean),
  cause: Schema.optional(Schema.Defect),
}) {}

export class PatchError extends Schema.TaggedErrorClass<PatchError>()("Git.PatchError", {
  operation: Schema.Literals(["capture", "apply", "reset"]),
  directory: AbsolutePath,
  message: Schema.String,
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
  readonly patch: (directory: AbsolutePath) => Effect.Effect<string, PatchError>
  readonly applyPatch: (input: { directory: AbsolutePath; patch: string }) => Effect.Effect<void, PatchError>
  readonly resetChanges: (directory: AbsolutePath) => Effect.Effect<void, PatchError>
  readonly softResetChanges: (directory: AbsolutePath) => Effect.Effect<void, PatchError>
  readonly worktreeCreate: (input: { repo: Repo; directory: AbsolutePath }) => Effect.Effect<void, WorktreeError>
  readonly worktreeRemove: (input: {
    repo: Repo
    directory: AbsolutePath
    force: boolean
  }) => Effect.Effect<void, WorktreeError>
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

    const patch = Effect.fn("Git.patch")(function* (directory: AbsolutePath) {
      const root = yield* execute(
        directory,
        proc,
      )(["rev-parse", "--show-toplevel"]).pipe(
        Effect.mapError((cause) => new PatchError({ operation: "capture", directory, message: cause.message, cause })),
      )
      if (root.exitCode !== 0) {
        return yield* new PatchError({
          operation: "capture",
          directory,
          message: root.stderr.trim() || root.text.trim() || "Failed to locate repository root",
        })
      }
      const repo = AbsolutePath.make(resolvePath(directory, root.text))
      const scope = path.relative(repo, directory).replaceAll("\\", "/") || "."
      const tracked = yield* execute(
        repo,
        proc,
      )(["diff", "--binary", "HEAD", "--", scope]).pipe(
        Effect.mapError((cause) => new PatchError({ operation: "capture", directory, message: cause.message, cause })),
      )
      if (tracked.exitCode !== 0) {
        return yield* new PatchError({
          operation: "capture",
          directory,
          message: tracked.stderr.trim() || tracked.text.trim() || "Failed to capture tracked changes",
        })
      }

      const untracked = yield* execute(
        repo,
        proc,
      )(["ls-files", "--others", "--exclude-standard", "-z", "--", scope]).pipe(
        Effect.mapError((cause) => new PatchError({ operation: "capture", directory, message: cause.message, cause })),
      )
      if (untracked.exitCode !== 0) {
        return yield* new PatchError({
          operation: "capture",
          directory,
          message: untracked.stderr.trim() || untracked.text.trim() || "Failed to list untracked changes",
        })
      }

      const created = yield* Effect.forEach(untracked.text.split("\0").filter(Boolean), (file) =>
        execute(
          repo,
          proc,
        )(["diff", "--binary", "--no-index", "--", "/dev/null", file]).pipe(
          Effect.mapError(
            (cause) => new PatchError({ operation: "capture", directory, message: cause.message, cause }),
          ),
          Effect.flatMap((result) =>
            // git diff --no-index returns 1 when differences were found.
            result.exitCode === 0 || result.exitCode === 1
              ? Effect.succeed(result.text)
              : Effect.fail(
                  new PatchError({
                    operation: "capture",
                    directory,
                    message:
                      result.stderr.trim() || result.text.trim() || `Failed to capture untracked change: ${file}`,
                  }),
                ),
          ),
        ),
      )
      return [tracked.text, ...created].filter(Boolean).join("\n")
    })

    const applyPatch = Effect.fn("Git.applyPatch")(function* (input: { directory: AbsolutePath; patch: string }) {
      const result = yield* proc
        .run(
          ChildProcess.make("git", ["apply", "-"], {
            cwd: input.directory,
            extendEnv: true,
            stdin: Stream.make(new TextEncoder().encode(input.patch)),
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new PatchError({ operation: "apply", directory: input.directory, message: cause.message, cause }),
          ),
        )
      if (result.exitCode === 0) return
      return yield* new PatchError({
        operation: "apply",
        directory: input.directory,
        message:
          result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim() || "Failed to apply changes",
      })
    })

    const resetChanges = Effect.fn("Git.resetChanges")(function* (directory: AbsolutePath) {
      const reset = yield* execute(
        directory,
        proc,
      )(["reset", "--hard", "HEAD"]).pipe(
        Effect.mapError((cause) => new PatchError({ operation: "reset", directory, message: cause.message, cause })),
      )
      if (reset.exitCode !== 0) {
        return yield* new PatchError({
          operation: "reset",
          directory,
          message: reset.stderr.trim() || reset.text.trim() || "Failed to reset tracked changes",
        })
      }
      const clean = yield* execute(
        directory,
        proc,
      )(["clean", "-fd"]).pipe(
        Effect.mapError((cause) => new PatchError({ operation: "reset", directory, message: cause.message, cause })),
      )
      if (clean.exitCode === 0) return
      return yield* new PatchError({
        operation: "reset",
        directory,
        message: clean.stderr.trim() || clean.text.trim() || "Failed to clean untracked changes",
      })
    })

    const softResetChanges = Effect.fn("Git.softResetChanges")(function* (directory: AbsolutePath) {
      const checkout = yield* execute(
        directory,
        proc,
      )(["checkout", "--", "."]).pipe(
        Effect.mapError((cause) => new PatchError({ operation: "reset", directory, message: cause.message, cause })),
      )
      if (checkout.exitCode !== 0) {
        return yield* new PatchError({
          operation: "reset",
          directory,
          message: checkout.stderr.trim() || checkout.text.trim() || "Failed to restore tracked changes",
        })
      }
      const clean = yield* execute(
        directory,
        proc,
      )(["clean", "-fd", "--", "."]).pipe(
        Effect.mapError((cause) => new PatchError({ operation: "reset", directory, message: cause.message, cause })),
      )
      if (clean.exitCode === 0) return
      return yield* new PatchError({
        operation: "reset",
        directory,
        message: clean.stderr.trim() || clean.text.trim() || "Failed to clean untracked changes",
      })
    })

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
      const message = result.stderr.toString("utf8").trim() || result.stdout.toString("utf8").trim() || "Git failed"
      return yield* new WorktreeError({
        operation,
        directory: worktreeDirectory,
        message,
        forceRequired: operation === "remove" && /contains modified or untracked files|is dirty/i.test(message),
      })
    })

    const worktreeCreate = Effect.fn("Git.worktreeCreate")(function* (input: { repo: Repo; directory: AbsolutePath }) {
      yield* worktree("create", input.repo, ["worktree", "add", "--detach", input.directory, "HEAD"], input.directory)
    })

    const worktreeRemove = Effect.fn("Git.worktreeRemove")(function* (input: {
      repo: Repo
      directory: AbsolutePath
      force: boolean
    }) {
      yield* worktree(
        "remove",
        input.repo,
        ["worktree", "remove", ...(input.force ? ["--force"] : []), input.directory],
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
      patch,
      applyPatch,
      resetChanges,
      softResetChanges,
      worktreeCreate,
      worktreeRemove,
      worktreeList,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FSUtil.defaultLayer), Layer.provide(AppProcess.defaultLayer))
export const node = LayerNode.make(layer, [FSUtil.node, AppProcess.node])

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
