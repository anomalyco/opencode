export * as Git from "./git.js"

import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AbsolutePath, RelativePath } from "./schema.js"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { AppProcess } from "@opencode-ai/util/process"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import { File } from "./file.js"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { VcsPatch } from "./vcs/patch.js"

export class Repository extends Schema.Class<Repository>("Git.Repository")({
  worktree: AbsolutePath,
  gitDirectory: AbsolutePath,
  commonDirectory: AbsolutePath,
}) {}

// Included from $GIT_DIR/config via include.path (git >= 1.7.10); OpenCode owns
// this file entirely, so updates are plain rewrites with no config parsing.
const snapshotConfigFile = "opencode.gitconfig"
const snapshotConfigInclude = `[include]
	path = ${snapshotConfigFile}
`
const snapshotConfig = `[core]
	autocrlf = false
	longpaths = true
	symlinks = true
	fsmonitor = false
	untrackedCache = true
[feature]
	manyFiles = true
[index]
	version = 4
	threads = true
`

export const TreeID = Schema.String.pipe(Schema.brand("Git.TreeID"))
export type TreeID = typeof TreeID.Type

export class OperationError extends Schema.TaggedError<OperationError>()("Git.OperationError", {
  operation: Schema.Literals([
    "clone",
    "fetch",
    "checkout",
    "reset",
    "create",
    "refresh",
    "write_tree",
    "list_files",
    "diff",
    "restore",
  ]),
  message: Schema.String,
  directory: Schema.optional(AbsolutePath),
  cause: Schema.optional(Schema.Defect()),
}) {}

export class Worktree extends Schema.Class<Worktree>("Git.Worktree")({
  directory: AbsolutePath,
  kind: Schema.Literals(["main", "linked"]),
}) {}

export class WorktreeError extends Schema.TaggedError<WorktreeError>()("Git.WorktreeError", {
  operation: Schema.Literals(["create", "remove", "list"]),
  message: Schema.String,
  directory: Schema.optional(AbsolutePath),
  forceRequired: Schema.optional(Schema.Boolean),
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly repo: {
    readonly discover: (input: AbsolutePath) => Effect.Effect<Repository | undefined>
    readonly clone: (input: {
      remote: string
      directory: AbsolutePath
      branch?: string
      depth?: number
    }) => Effect.Effect<Repository, OperationError>
    readonly create: (input: {
      worktree: AbsolutePath
      gitDirectory: AbsolutePath
      seed?: Repository
    }) => Effect.Effect<Repository, OperationError>
  }
  readonly remote: {
    readonly get: (repository: Repository, name?: string) => Effect.Effect<string | undefined>
  }
  readonly history: {
    readonly head: (repository: Repository) => Effect.Effect<string | undefined>
    readonly branch: (repository: Repository) => Effect.Effect<string | undefined>
    readonly defaultRemoteBranch: (repository: Repository, remote?: string) => Effect.Effect<string | undefined>
    readonly rootCommits: (repository: Repository) => Effect.Effect<readonly string[]>
  }
  readonly sync: {
    readonly fetchRemotes: (repository: Repository, input?: { prune?: boolean }) => Effect.Effect<void, OperationError>
    readonly fetchBranch: (
      repository: Repository,
      input: { remote?: string; branch: string; force?: boolean },
    ) => Effect.Effect<void, OperationError>
    readonly checkoutRemoteBranch: (
      repository: Repository,
      input: { remote?: string; branch: string; reset?: boolean },
    ) => Effect.Effect<void, OperationError>
    readonly resetHard: (repository: Repository, revision: string) => Effect.Effect<void, OperationError>
  }
  readonly worktree: {
    readonly create: (input: {
      repository: Repository
      directory: AbsolutePath
      ref?: string
    }) => Effect.Effect<Repository, WorktreeError>
    readonly remove: (input: {
      repository: Repository
      directory: AbsolutePath
      force: boolean
    }) => Effect.Effect<void, WorktreeError>
    readonly list: (repository: Repository) => Effect.Effect<readonly Worktree[], WorktreeError>
  }
  readonly index: {
    /** Refresh only the requested project-relative scope, preserving all other entries. */
    readonly refresh: (input: {
      repository: Repository
      scope: RelativePath
      ignores?: Repository
      maximumUntrackedFileBytes?: number
    }) => Effect.Effect<{ readonly skipped: readonly RelativePath[] }, OperationError>
    readonly ignored: (input: {
      repository: Repository
      paths: readonly RelativePath[]
    }) => Effect.Effect<ReadonlySet<RelativePath>, OperationError>
  }
  readonly tree: {
    readonly capture: (input: {
      repository: Repository
      scopes: readonly RelativePath[]
      ignores?: Repository
      maximumUntrackedFileBytes?: number
    }) => Effect.Effect<TreeID, OperationError>
    readonly write: (repository: Repository) => Effect.Effect<TreeID, OperationError>
    readonly files: (input: {
      repository: Repository
      from: TreeID
      to: TreeID
    }) => Effect.Effect<readonly RelativePath[], OperationError>
    readonly diff: (input: {
      repository: Repository
      from: TreeID
      to: TreeID
      context?: number
      paths?: readonly RelativePath[]
    }) => Effect.Effect<readonly File.Diff[], OperationError>
    readonly restore: (input: {
      repository: Repository
      files: ReadonlyMap<RelativePath, TreeID>
    }) => Effect.Effect<void, OperationError>
  }
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Git") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const proc = yield* AppProcess.Service
    const locks = KeyedMutex.makeUnsafe<string>()
    const locked = <A, E, R>(repository: Repository, effect: Effect.Effect<A, E, R>) =>
      locks.withLock(repository.gitDirectory)(effect)

    const discover = Effect.fn("Git.repo.discover")(function* (input: AbsolutePath) {
      const dotgit = yield* fs.up({ targets: [".git"], start: input, mode: "first" }).pipe(
        Effect.map((matches) => matches[0]),
        Effect.orElseSucceed(() => undefined),
      )
      if (!dotgit) return undefined

      const cwd = path.dirname(dotgit)
      const result = yield* run(cwd, proc, ["rev-parse", "--git-dir", "--git-common-dir", "--show-toplevel"])
      const [gitDir, commonDir, topLevel] = result.text.split(/\r?\n/)
      if (!gitDir || !commonDir) return undefined

      return new Repository({
        worktree: AbsolutePath.make(topLevel ? resolvePath(cwd, topLevel) : cwd),
        gitDirectory: AbsolutePath.make(resolvePath(cwd, gitDir)),
        commonDirectory: AbsolutePath.make(resolvePath(cwd, commonDir)),
      })
    })

    const remote = Effect.fn("Git.remote.get")(function* (repository: Repository, name = "origin") {
      const result = yield* run(repository.worktree, proc, ["remote", "get-url", name])
      if (result.exitCode !== 0) return undefined
      return result.text.trim() || undefined
    })

    const roots = Effect.fn("Git.history.rootCommits")(function* (repository: Repository) {
      const result = yield* run(repository.worktree, proc, ["rev-list", "--max-parents=0", "HEAD"])
      if (result.exitCode !== 0) return []
      return result.text
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
        .toSorted()
    })

    const head = Effect.fn("Git.history.head")(function* (repository: Repository) {
      const result = yield* run(repository.worktree, proc, ["rev-parse", "HEAD"])
      if (result.exitCode !== 0) return undefined
      return result.text.trim() || undefined
    })

    const branch = Effect.fn("Git.history.branch")(function* (repository: Repository) {
      const result = yield* run(repository.worktree, proc, ["symbolic-ref", "--quiet", "--short", "HEAD"])
      if (result.exitCode !== 0) return undefined
      return result.text.trim() || undefined
    })

    const remoteHead = Effect.fn("Git.history.defaultRemoteBranch")(function* (
      repository: Repository,
      remoteName = "origin",
    ) {
      const result = yield* run(repository.worktree, proc, ["symbolic-ref", `refs/remotes/${remoteName}/HEAD`])
      if (result.exitCode !== 0) return undefined
      return result.text.trim().replace(new RegExp(`^refs/remotes/${remoteName}/`), "") || undefined
    })

    const operation = Effect.fnUntraced(function* (
      operation: OperationError["operation"],
      directory: AbsolutePath,
      args: string[],
    ) {
      const result = yield* execute(directory, proc, args).pipe(
        Effect.mapError((cause) => new OperationError({ operation, directory, message: cause.message, cause })),
      )
      if (result.exitCode === 0) return
      return yield* new OperationError({
        operation,
        directory,
        message: result.stderr.trim() || result.text.trim() || `Git ${operation} failed`,
      })
    })

    const clone = Effect.fn("Git.repo.clone")(function* (input: {
      remote: string
      directory: AbsolutePath
      branch?: string
      depth?: number
    }) {
      yield* operation("clone", AbsolutePath.make(path.dirname(input.directory)), [
        "clone",
        "--depth",
        String(input.depth ?? 100),
        ...(input.branch ? ["--branch", input.branch] : []),
        "--",
        input.remote,
        input.directory,
      ])
      const repository = yield* discover(input.directory)
      if (repository) return repository
      return yield* new OperationError({
        operation: "clone",
        directory: input.directory,
        message: "Cloned repository could not be opened",
      })
    })

    const fetch = Effect.fn("Git.sync.fetchRemotes")(function* (
      repository: Repository,
      input: { prune?: boolean } = {},
    ) {
      yield* operation("fetch", repository.worktree, ["fetch", "--all", ...(input.prune === false ? [] : ["--prune"])])
    })

    const fetchBranch = Effect.fn("Git.sync.fetchBranch")(function* (
      repository: Repository,
      input: { remote?: string; branch: string; force?: boolean },
    ) {
      const remoteName = input.remote ?? "origin"
      const spec = `refs/heads/${input.branch}:refs/remotes/${remoteName}/${input.branch}`
      yield* operation("fetch", repository.worktree, ["fetch", remoteName, input.force === false ? spec : `+${spec}`])
    })

    const checkout = Effect.fn("Git.sync.checkoutRemoteBranch")(function* (
      repository: Repository,
      input: { remote?: string; branch: string; reset?: boolean },
    ) {
      const remoteName = input.remote ?? "origin"
      yield* operation("checkout", repository.worktree, [
        "checkout",
        ...(input.reset === false ? [input.branch] : ["-B", input.branch, `${remoteName}/${input.branch}`]),
      ])
    })

    const reset = Effect.fn("Git.sync.resetHard")(function* (repository: Repository, revision: string) {
      yield* operation("reset", repository.worktree, ["reset", "--hard", revision])
    })

    const repositoryArgs = (repository: Repository, args: string[]) => [
      "--git-dir",
      repository.gitDirectory,
      "--work-tree",
      repository.worktree,
      ...args,
    ]

    const repositoryOperation = Effect.fnUntraced(function* (
      operationName: OperationError["operation"],
      repository: Repository,
      args: string[],
      options?: { stdin?: string; env?: Record<string, string> },
    ) {
      const result = yield* proc
        .run(
          ChildProcess.make("git", repositoryArgs(repository, args), {
            cwd: repository.worktree,
            env: options?.env,
            extendEnv: true,
          }),
          { stdin: options?.stdin },
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new OperationError({
                operation: operationName,
                directory: repository.worktree,
                message: cause.message,
                cause,
              }),
          ),
        )
      const text = result.stdout.toString("utf8")
      if (result.exitCode === 0) return { text, stderr: result.stderr.toString("utf8") }
      return yield* new OperationError({
        operation: operationName,
        directory: repository.worktree,
        message: result.stderr.toString("utf8").trim() || text.trim() || `Git ${operationName} failed`,
      })
    })

    const create = Effect.fn("Git.repo.create")(function* (input: {
      worktree: AbsolutePath
      gitDirectory: AbsolutePath
      seed?: Repository
    }) {
      const operationError = (message: string) => (cause: unknown) =>
        new OperationError({ operation: "create", directory: input.gitDirectory, message, cause })
      yield* fs.ensureDir(input.gitDirectory).pipe(Effect.mapError(operationError("Failed to create Git storage")))
      const repository = new Repository({
        worktree: input.worktree,
        gitDirectory: input.gitDirectory,
        commonDirectory: input.gitDirectory,
      })
      yield* repositoryOperation("create", repository, ["init"])
      yield* Effect.gen(function* () {
        yield* fs.writeFileString(path.join(input.gitDirectory, snapshotConfigFile), snapshotConfig)
        const config = path.join(input.gitDirectory, "config")
        const current = yield* fs.readFileString(config)
        if (current.includes(snapshotConfigInclude)) return
        yield* fs.writeFileString(config, `${current.endsWith("\n") ? "\n" : "\n\n"}${snapshotConfigInclude}`, {
          flag: "a",
        })
      }).pipe(Effect.mapError(operationError("Failed to configure Git storage")))
      if (!input.seed) return repository
      yield* fs
        .ensureDir(path.join(input.gitDirectory, "objects", "info"))
        .pipe(Effect.mapError(operationError("Failed to configure shared Git objects")))
      yield* fs
        .writeFileString(
          path.join(input.gitDirectory, "objects", "info", "alternates"),
          path.join(input.seed.commonDirectory, "objects") + "\n",
        )
        .pipe(Effect.mapError(operationError("Failed to configure shared Git objects")))
      yield* fs
        .copyFile(path.join(input.seed.gitDirectory, "index"), path.join(input.gitDirectory, "index"))
        .pipe(Effect.ignore)
      return repository
    })

    const refresh = Effect.fn("Git.index.refresh")(function* (input: {
      repository: Repository
      scope: RelativePath
      ignores?: Repository
      maximumUntrackedFileBytes?: number
    }) {
      const list = (args: string[]) =>
        repositoryOperation("refresh", input.repository, args).pipe(
          Effect.map((result) => result.text.split("\0").filter(Boolean)),
        )
      const [tracked, untracked] = yield* Effect.all(
        [
          list(["diff-files", "--name-only", "-z", "--", input.scope]),
          list(["ls-files", "--others", "--exclude-standard", "-z", "--", input.scope]),
        ],
        { concurrency: 2 },
      )
      const candidates = Array.from(new Set([...tracked, ...untracked])).map((file) => RelativePath.make(file))
      if (!candidates.length) return { skipped: [] }
      const excluded = input.ignores
        ? yield* ignored({ repository: input.ignores, paths: candidates })
        : new Set<RelativePath>()
      const allowed = candidates.filter((item) => !excluded.has(item))
      const maximum = input.maximumUntrackedFileBytes
      const skipped = maximum
        ? (yield* Effect.forEach(
            untracked.filter((item) => allowed.includes(RelativePath.make(item))),
            (item) =>
              fs.stat(path.join(input.repository.worktree, item)).pipe(
                Effect.map((info) =>
                  info.type === "File" && Number(info.size) > maximum ? RelativePath.make(item) : undefined,
                ),
                Effect.orElseSucceed(() => undefined),
              ),
            { concurrency: 8 },
          )).filter((item): item is RelativePath => item !== undefined)
        : []
      const stage = allowed.filter((item) => !skipped.includes(item))
      const remove = [...excluded, ...skipped]
      if (remove.length)
        yield* repositoryOperation(
          "refresh",
          input.repository,
          ["rm", "--cached", "-f", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"],
          { stdin: remove.join("\0") + "\0" },
        )
      if (stage.length)
        yield* repositoryOperation(
          "refresh",
          input.repository,
          ["add", "--all", "--sparse", "--pathspec-from-file=-", "--pathspec-file-nul"],
          { stdin: stage.join("\0") + "\0" },
        )
      return { skipped }
    })

    const ignored = Effect.fn("Git.index.ignored")(function* (input: {
      repository: Repository
      paths: readonly RelativePath[]
    }) {
      if (!input.paths.length) return new Set<RelativePath>()
      const result = yield* proc
        .run(
          ChildProcess.make("git", repositoryArgs(input.repository, ["check-ignore", "--no-index", "--stdin", "-z"]), {
            cwd: input.repository.worktree,
            extendEnv: true,
          }),
          { stdin: input.paths.join("\0") + "\0" },
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new OperationError({
                operation: "list_files",
                directory: input.repository.worktree,
                message: cause.message,
                cause,
              }),
          ),
        )
      if (result.exitCode !== 0 && result.exitCode !== 1)
        return yield* new OperationError({
          operation: "list_files",
          directory: input.repository.worktree,
          message: result.stderr.toString("utf8").trim() || "Failed to check ignored paths",
        })
      return new Set(
        result.stdout
          .toString("utf8")
          .split("\0")
          .filter(Boolean)
          .map((file) => RelativePath.make(file)),
      )
    })

    const writeTree = Effect.fn("Git.tree.write")(function* (repository: Repository) {
      return TreeID.make((yield* repositoryOperation("write_tree", repository, ["write-tree"])).text.trim())
    })

    const captureTree = Effect.fn("Git.tree.capture")(
      (input: {
        repository: Repository
        scopes: readonly RelativePath[]
        ignores?: Repository
        maximumUntrackedFileBytes?: number
      }) =>
        locked(
          input.repository,
          Effect.gen(function* () {
            yield* Effect.forEach(input.scopes, (scope) => refresh({ ...input, scope }), { discard: true })
            return yield* writeTree(input.repository)
          }),
        ),
    )

    const treeFiles = Effect.fn("Git.tree.files")(function* (input: {
      repository: Repository
      from: TreeID
      to: TreeID
    }) {
      // Undo needs both paths of a rename, not only its destination.
      return (yield* repositoryOperation("list_files", input.repository, [
        "diff",
        "--name-only",
        "--no-renames",
        "-z",
        input.from,
        input.to,
      ])).text
        .split("\0")
        .filter(Boolean)
        .map((file) => RelativePath.make(file))
    })

    const treeDiff = Effect.fn("Git.tree.diff")(function* (input: {
      repository: Repository
      from: TreeID
      to: TreeID
      context?: number
      paths?: readonly RelativePath[]
    }) {
      const diffs = new Map<RelativePath, File.Diff>()
      // Stable headers keep user diff settings from mixing neighboring files' patch chunks.
      const read = (options: string[], paths: readonly RelativePath[]) =>
        repositoryOperation("diff", input.repository, [
          "--literal-pathspecs",
          "diff",
          "--no-ext-diff",
          "--no-color",
          "--no-renames",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          "--submodule=short",
          ...options,
          input.from,
          input.to,
          "--",
          ...paths,
        ])
      for (const paths of input.paths === undefined
        ? [[]]
        : pathBatches(input.paths.map((file) => repositoryPath(input.repository, file)))) {
        const result = yield* Effect.all(
          {
            names: read(["--name-status", "-z"], paths),
            stats: read(["--numstat", "-z"], paths),
            patch: read([`--unified=${input.context ?? 3}`], paths),
          },
          { concurrency: 3 },
        )
        const names = result.names.text.split("\0")
        const statuses = new Map(
          names.flatMap((status, index) => (index % 2 === 0 && status ? [[names[index + 1], status] as const] : [])),
        )
        const patches = VcsPatch.chunksByFile({ text: result.patch.text, truncated: false }, () => undefined)
        for (const entry of result.stats.text.split("\0").filter(Boolean)) {
          const first = entry.indexOf("\t")
          const second = entry.indexOf("\t", first + 1)
          const file = RelativePath.make(entry.slice(second + 1))
          const additions = entry.slice(0, first)
          const deletions = entry.slice(first + 1, second)
          const binary = additions === "-" || deletions === "-"
          const status = statuses.get(file)
          diffs.set(file, {
            file,
            status: status === "A" ? "added" : status === "D" ? "deleted" : "modified",
            additions: binary ? 0 : Number(additions),
            deletions: binary ? 0 : Number(deletions),
            patch: binary ? "" : (patches.get(file) ?? ""),
          })
        }
      }
      return input.paths === undefined
        ? Array.from(diffs.values())
        : input.paths.map((file) => {
            const diff = diffs.get(repositoryPath(input.repository, file))
            return diff
              ? { ...diff, file }
              : { file, status: "modified" as const, additions: 0, deletions: 0, patch: "" }
          })
    })

    const restore = Effect.fn("Git.tree.restore")(
      (input: { repository: Repository; files: ReadonlyMap<RelativePath, TreeID> }) =>
        locked(
          input.repository,
          Effect.gen(function* () {
            // Only group consecutive snapshots: directory restores can overlap paths from another snapshot.
            const groups: { tree: TreeID; files: RelativePath[] }[] = []
            for (const [inputPath, tree] of input.files) {
              const file = repositoryPath(input.repository, inputPath)
              const previous = groups.at(-1)
              if (previous?.tree === tree) {
                previous.files.push(file)
                continue
              }
              groups.push({ tree, files: [file] })
            }
            for (const group of groups) {
              // Checkout uses stdin, so its batch can span multiple argv-limited lookups.
              const pending: RelativePath[] = []
              const flush = () =>
                pending.length === 0
                  ? Effect.void
                  : repositoryOperation(
                      "restore",
                      input.repository,
                      ["--literal-pathspecs", "checkout", group.tree, "--pathspec-from-file=-", "--pathspec-file-nul"],
                      { stdin: pending.splice(0).join("\0") + "\0" },
                    )
              for (const paths of pathBatches(group.files)) {
                const entries = new Set(
                  (yield* repositoryOperation("restore", input.repository, [
                    "--literal-pathspecs",
                    "ls-tree",
                    "--name-only",
                    "-t",
                    "-z",
                    group.tree,
                    "--",
                    ...paths,
                  ])).text
                    .split("\0")
                    .filter(Boolean),
                )
                for (const file of paths) {
                  if (entries.has(file) || (file === "." && entries.size > 0)) {
                    pending.push(file)
                    continue
                  }
                  // Keep deletions in their original position relative to the surrounding checkouts.
                  yield* flush()
                  yield* fs.remove(path.join(input.repository.worktree, file), { recursive: true, force: true }).pipe(
                    Effect.mapError(
                      (cause) =>
                        new OperationError({
                          operation: "restore",
                          directory: input.repository.worktree,
                          message: `Failed to remove ${file}`,
                          cause,
                        }),
                    ),
                  )
                }
              }
              yield* flush()
            }
          }),
        ),
    )

    const worktreeRun = Effect.fnUntraced(function* (
      operation: "create" | "remove" | "list",
      repository: Repository,
      args: string[],
      worktreeDirectory?: AbsolutePath,
      cwd = repository.worktree,
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

    const worktreeCreate = Effect.fn("Git.worktree.create")(function* (input: {
      repository: Repository
      directory: AbsolutePath
      ref?: string
    }) {
      yield* worktreeRun(
        "create",
        input.repository,
        ["worktree", "add", "--detach", "--", input.directory, input.ref ?? "HEAD"],
        input.directory,
      )
      const repository = yield* discover(input.directory)
      if (repository) return repository
      return yield* new WorktreeError({
        operation: "create",
        directory: input.directory,
        message: "Created worktree could not be opened",
      })
    })

    const worktreeRemove = Effect.fn("Git.worktree.remove")(function* (input: {
      repository: Repository
      directory: AbsolutePath
      force: boolean
    }) {
      yield* worktreeRun(
        "remove",
        input.repository,
        ["worktree", "remove", ...(input.force ? ["--force"] : []), input.directory],
        input.directory,
        input.repository.commonDirectory,
      )
    })

    const worktreeList = Effect.fn("Git.worktree.list")(function* (repository: Repository) {
      return (yield* worktreeRun("list", repository, ["worktree", "list", "--porcelain"]))
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map(
          (line, index) =>
            new Worktree({
              directory: AbsolutePath.make(resolvePath(repository.worktree, line.slice("worktree ".length).trim())),
              kind: index === 0 ? "main" : "linked",
            }),
        )
    })

    return Service.of({
      repo: { discover, clone, create },
      remote: { get: remote },
      history: { head, branch, defaultRemoteBranch: remoteHead, rootCommits: roots },
      sync: { fetchRemotes: fetch, fetchBranch, checkoutRemoteBranch: checkout, resetHard: reset },
      worktree: { create: worktreeCreate, remove: worktreeRemove, list: worktreeList },
      index: { refresh, ignored },
      tree: {
        capture: captureTree,
        write: writeTree,
        files: treeFiles,
        diff: treeDiff,
        restore,
      },
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [FSUtil.node, AppProcess.node] })

function repositoryPath(repository: Repository, file: RelativePath) {
  return RelativePath.make(
    path.relative(repository.worktree, path.resolve(repository.worktree, file)).split(path.sep).join("/") || ".",
  )
}

// diff and ls-tree have no pathspec-from-file option. Bound argv size, including quoting overhead on Windows.
function pathBatches(paths: readonly RelativePath[]) {
  const batches: RelativePath[][] = []
  let bytes = 0
  for (const file of paths) {
    const size = Buffer.byteLength(file) + 3
    if (batches.length === 0 || bytes + size > 16_384) {
      batches.push([])
      bytes = 0
    }
    batches[batches.length - 1].push(file)
    bytes += size
  }
  return batches
}

interface Result {
  readonly exitCode: number
  readonly text: string
  readonly stderr: string
}

function run(cwd: string, proc: AppProcess.Interface, args: string[]) {
  return execute(cwd, proc, args).pipe(Effect.orElseSucceed(() => ({ exitCode: 1, text: "", stderr: "" })))
}

function execute(cwd: string, proc: AppProcess.Interface, args: string[]) {
  return proc
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
