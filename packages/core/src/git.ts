export * as Git from "./git.js"

import path from "path"
import { Cause, Context, Effect, Exit, Layer, Option, Schedule, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AbsolutePath, RelativePath } from "./schema.js"
import { FSUtil } from "@opencode/util/fs-util"
import { AppProcess } from "@opencode/util/process"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { FileDiff } from "@opencode/schema/file-diff"
import { KeyedMutex } from "./effect/keyed-mutex.js"
import { VcsPatch } from "./vcs/patch.js"
import { gitExecutable } from "./util/git-executable.js"

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
	# A split index cannot name its shared file once manyFiles skips index checksums.
	splitIndex = false
[feature]
	manyFiles = true
[index]
	version = 4
	threads = true
`

export const TreeID = Schema.String.pipe(Schema.brand("Git.TreeID"))
export type TreeID = typeof TreeID.Type

const privateIndexPrefix = "index.opencode-"
const excludeMarker = "# opencode: mirrored from the source repository; edits below are replaced\n"
// Like `git gc --auto`, pack once loose objects accumulate, and merge packs before lookups slow down.
const compactLooseLimit = 2048
const compactPackLimit = 16

export interface CaptureInput {
  readonly repository: Repository
  readonly scopes: readonly RelativePath[]
  /** Source repository whose ignore rules decide which paths are recorded. */
  readonly ignores?: Repository
  /** Repository whose index rebuilds a corrupt snapshot index without rehashing tracked files. */
  readonly seed?: Repository
  readonly maximumUntrackedFileBytes?: number
}

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
    "compact",
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
    readonly capture: (input: CaptureInput) => Effect.Effect<TreeID, OperationError>
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
    }) => Effect.Effect<readonly FileDiff.Info[], OperationError>
    readonly restore: (input: {
      repository: Repository
      files: ReadonlyMap<RelativePath, TreeID>
    }) => Effect.Effect<void, OperationError>
  }
  readonly objects: {
    /**
     * Pack loose objects and merge small packs without dropping any object,
     * reachable or not. Returns without work below the thresholds; safe to run
     * concurrently with captures and with other processes.
     */
    readonly compact: (repository: Repository) => Effect.Effect<void, OperationError>
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
      options?: { stdin?: string | Uint8Array; env?: Record<string, string>; maxOutputBytes?: number; index?: string },
    ) {
      const result = yield* proc
        .run(
          ChildProcess.make(gitExecutable, repositoryArgs(repository, args), {
            cwd: repository.worktree,
            env: options?.index ? { ...options.env, GIT_INDEX_FILE: options.index } : options?.env,
            extendEnv: true,
          }),
          { stdin: options?.stdin, maxOutputBytes: options?.maxOutputBytes },
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
      if (result.exitCode === 0)
        return { text, stderr: result.stderr.toString("utf8"), truncated: result.stdoutTruncated }
      return yield* new OperationError({
        operation: operationName,
        directory: repository.worktree,
        message: result.stderr.toString("utf8").trim() || text.trim() || `Git ${operationName} failed`,
      })
    })

    /**
     * A new store is initialized in a private staging directory and renamed into
     * place, so processes racing to create the same store never observe or write a
     * half-initialized one; the loser discards its copy and adopts the winner's.
     */
    const create = Effect.fn("Git.repo.create")(function* (input: {
      worktree: AbsolutePath
      gitDirectory: AbsolutePath
      seed?: Repository
    }) {
      const repository = new Repository({
        worktree: input.worktree,
        gitDirectory: input.gitDirectory,
        commonDirectory: input.gitDirectory,
      })
      if (yield* fs.existsSafe(path.join(input.gitDirectory, "HEAD"))) {
        yield* initialize({ ...input, directory: input.gitDirectory })
        return repository
      }
      const staging = AbsolutePath.make(
        `${input.gitDirectory}.init-${process.pid}-${Math.random().toString(36).slice(2)}`,
      )
      yield* Effect.acquireUseRelease(
        Effect.succeed(staging),
        (directory) =>
          Effect.gen(function* () {
            yield* initialize({ ...input, directory })
            const renamed = yield* fs.rename(directory, input.gitDirectory).pipe(Effect.exit)
            if (Exit.isSuccess(renamed) || (yield* fs.existsSafe(path.join(input.gitDirectory, "HEAD")))) return
            return yield* new OperationError({
              operation: "create",
              directory: input.gitDirectory,
              message: "Failed to move Git storage into place",
              cause: Cause.squash(renamed.cause),
            })
          }),
        (directory) => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore),
      )
      return repository
    })

    const initialize = Effect.fnUntraced(function* (input: {
      worktree: AbsolutePath
      gitDirectory: AbsolutePath
      directory: AbsolutePath
      seed?: Repository
    }) {
      const operationError = (message: string) => (cause: unknown) =>
        new OperationError({ operation: "create", directory: input.gitDirectory, message, cause })
      yield* fs.ensureDir(input.directory).pipe(Effect.mapError(operationError("Failed to create Git storage")))
      yield* repositoryOperation(
        "create",
        new Repository({ worktree: input.worktree, gitDirectory: input.directory, commonDirectory: input.directory }),
        ["init"],
      )
      yield* Effect.gen(function* () {
        yield* fs.writeFileString(path.join(input.directory, snapshotConfigFile), snapshotConfig)
        const config = path.join(input.directory, "config")
        const current = yield* fs.readFileString(config)
        if (current.includes(snapshotConfigInclude)) return
        yield* fs.writeFileString(config, `${current.endsWith("\n") ? "\n" : "\n\n"}${snapshotConfigInclude}`, {
          flag: "a",
        })
      }).pipe(Effect.mapError(operationError("Failed to configure Git storage")))
      if (!input.seed) return
      yield* fs
        .ensureDir(path.join(input.directory, "objects", "info"))
        .pipe(Effect.mapError(operationError("Failed to configure shared Git objects")))
      yield* fs
        .writeFileString(
          path.join(input.directory, "objects", "info", "alternates"),
          path.join(input.seed.commonDirectory, "objects") + "\n",
        )
        .pipe(Effect.mapError(operationError("Failed to configure shared Git objects")))
      yield* fs
        .copyFile(path.join(input.seed.gitDirectory, "index"), path.join(input.directory, "index"))
        .pipe(Effect.ignore)
    })

    /**
     * Report modified, deleted, and non-ignored untracked paths against the index.
     * Both commands only read the index, so they run against the shared index
     * without taking `index.lock`. Two parallel processes beat one combined
     * `ls-files -m -o`, whose lstat pass is not threaded like diff-files'.
     */
    const scan = Effect.fnUntraced(function* (repository: Repository, scope: RelativePath) {
      const list = (args: string[]) =>
        repositoryOperation("refresh", repository, args).pipe(
          // Embedded repositories are listed as `dir/`; update-index records them as gitlinks.
          Effect.map((result) => nuls(result.text).map((file) => RelativePath.make(file.replace(/\/$/, "")))),
        )
      const [tracked, untracked] = yield* Effect.all(
        [
          list(["diff-files", "--name-only", "-z", "--", literal(scope)]),
          list(["ls-files", "--others", "--exclude-standard", "-z", "--", literal(scope)]),
        ],
        { concurrency: 2 },
      )
      return { tracked, untracked }
    })

    const stage = Effect.fnUntraced(function* (input: {
      repository: Repository
      changes: { tracked: readonly RelativePath[]; untracked: readonly RelativePath[] }
      ignores?: Repository
      maximumUntrackedFileBytes?: number
      index?: string
    }) {
      const candidates = [...input.changes.tracked, ...input.changes.untracked]
      if (!candidates.length) return { skipped: [] }
      const excluded = input.ignores
        ? yield* ignored({ repository: input.ignores, paths: candidates })
        : new Set<RelativePath>()
      const maximum = input.maximumUntrackedFileBytes
      const skipped = maximum
        ? (yield* Effect.forEach(
            input.changes.untracked.filter((item) => !excluded.has(item)),
            (item) =>
              fs.stat(path.join(input.repository.worktree, item)).pipe(
                Effect.map((info) => (info.type === "File" && Number(info.size) > maximum ? item : undefined)),
                Effect.orElseSucceed(() => undefined),
              ),
            { concurrency: 8 },
          )).filter((item): item is RelativePath => item !== undefined)
        : []
      const skip = new Set(skipped)
      const staged = candidates.filter((item) => !excluded.has(item) && !skip.has(item))
      const removed = [...excluded, ...skipped]
      // update-index takes literal paths, so large lists avoid add's quadratic pathspec matching.
      if (removed.length)
        yield* repositoryOperation("refresh", input.repository, ["update-index", "--force-remove", "-z", "--stdin"], {
          stdin: removed.join("\0") + "\0",
          index: input.index,
        })
      if (staged.length)
        yield* repositoryOperation(
          "refresh",
          input.repository,
          ["update-index", "--add", "--remove", "--replace", "-z", "--stdin"],
          { stdin: staged.join("\0") + "\0", index: input.index },
        )
      return { skipped }
    })

    const refresh = Effect.fn("Git.index.refresh")(function* (input: {
      repository: Repository
      scope: RelativePath
      ignores?: Repository
      maximumUntrackedFileBytes?: number
    }) {
      return yield* stage({ ...input, changes: yield* scan(input.repository, input.scope) })
    })

    const ignored = Effect.fn("Git.index.ignored")(function* (input: {
      repository: Repository
      paths: readonly RelativePath[]
    }) {
      if (!input.paths.length) return new Set<RelativePath>()
      const result = yield* proc
        .run(
          ChildProcess.make(
            gitExecutable,
            repositoryArgs(input.repository, ["check-ignore", "--no-index", "--stdin", "-z"]),
            {
              cwd: input.repository.worktree,
              extendEnv: true,
            },
          ),
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
      return new Set(nuls(result.stdout.toString("utf8")).map((file) => RelativePath.make(file)))
    })

    const writeTree = Effect.fn("Git.tree.write")(function* (repository: Repository, index?: string) {
      const tree = (yield* repositoryOperation("write_tree", repository, ["write-tree"], { index })).text.trim()
      if (/^[0-9a-f]{40,64}$/.test(tree)) return TreeID.make(tree)
      return yield* new OperationError({
        operation: "write_tree",
        directory: repository.worktree,
        message: `Invalid tree ID: ${tree}`,
      })
    })

    const sharedIndex = (repository: Repository) => path.join(repository.gitDirectory, "index")
    /** Identity of an index file; Git only replaces an index by renaming a new file into place. */
    const stamp = (file: string) =>
      fs.stat(file).pipe(
        Effect.map((info) =>
          [Option.getOrUndefined(info.ino), info.size, Option.getOrUndefined(info.mtime)?.getTime()].join(":"),
        ),
        Effect.orElseSucceed(() => undefined),
      )

    /**
     * Run index writes against a private index, then publish it with an atomic
     * rename. Processes never contend on `index.lock`, an interrupted or killed
     * writer cannot leave a partial shared index, and a stale lock is irrelevant.
     * The private index starts as a hard link: Git never writes an index in place,
     * it writes a lock file and renames it over the private name, so the shared
     * file is never modified and no bytes are copied. The shared index is only a
     * stat cache over the object store; when writers race, the last publish wins
     * and the next capture reconciles against the worktree.
     */
    const privateIndex = <A, E, R>(repository: Repository, use: (index: string) => Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          const shared = sharedIndex(repository)
          const index = path.join(
            repository.gitDirectory,
            `${privateIndexPrefix}${process.pid}-${Math.random().toString(36).slice(2)}`,
          )
          if (!(yield* fs.existsSafe(shared))) return index
          const linked = yield* fs.link(shared, index).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          )
          if (linked) return index
          const info = yield* fs.stat(shared).pipe(Effect.option)
          yield* fs.copyFile(shared, index).pipe(
            Effect.mapError(
              (cause) =>
                new OperationError({
                  operation: "refresh",
                  directory: repository.gitDirectory,
                  message: "Failed to prepare a private index",
                  cause,
                }),
            ),
          )
          // A copy must keep the timestamp Git uses to detect racily clean entries.
          const mtime = Option.isSome(info) ? Option.getOrUndefined(info.value.mtime) : undefined
          if (mtime && Option.isSome(info))
            yield* fs
              .utimes(
                index,
                Option.getOrElse(info.value.atime, () => mtime),
                mtime,
              )
              .pipe(Effect.ignore)
          return index
        }),
        (index) =>
          Effect.gen(function* () {
            const value = yield* use(index)
            const published = yield* Effect.uninterruptible(
              Effect.gen(function* () {
                // Stamp the private file before it takes the shared name, so a concurrent publish can never
                // pair another writer's index with this tree.
                const identity = yield* stamp(index)
                const renamed = yield* fs.rename(index, sharedIndex(repository)).pipe(
                  // Windows reports a transient sharing violation while another process reads the index.
                  Effect.retry({ times: 3, schedule: Schedule.spaced("20 millis") }),
                  Effect.as(true),
                  Effect.orElseSucceed(() => false),
                )
                return renamed ? identity : undefined
              }),
            )
            return { value, published }
          }),
        (index) => fs.remove(index, { force: true }).pipe(Effect.ignore),
      )

    // Clean captures return the tree last written from the exact shared index they scanned.
    const trees = new Map<string, { readonly stamp: string; readonly tree: TreeID }>()
    const swept = new Set<string>()

    const captureOnce = Effect.fnUntraced(function* (input: CaptureInput) {
      yield* syncExcludes(input.repository, input.ignores)
      const changes = yield* Effect.forEach(input.scopes, (scope) => scan(input.repository, scope), {
        concurrency: "unbounded",
      })
      const current = yield* stamp(sharedIndex(input.repository))
      const cached = trees.get(input.repository.gitDirectory)
      if (
        current &&
        cached?.stamp === current &&
        changes.every((change) => !change.tracked.length && !change.untracked.length)
      )
        return cached.tree
      const result = yield* privateIndex(input.repository, (index) =>
        Effect.gen(function* () {
          yield* Effect.forEach(changes, (change) => stage({ ...input, changes: change, index }), { discard: true })
          return yield* writeTree(input.repository, index)
        }),
      )
      if (result.published) trees.set(input.repository.gitDirectory, { stamp: result.published, tree: result.value })
      if (!result.published) trees.delete(input.repository.gitDirectory)
      return result.value
    })

    const captureTree = Effect.fn("Git.tree.capture")((input: CaptureInput) =>
      locked(
        input.repository,
        Effect.gen(function* () {
          if (!swept.has(input.repository.gitDirectory)) {
            swept.add(input.repository.gitDirectory)
            yield* sweepPrivateIndexes(input.repository)
            yield* upgradeConfig(input.repository)
          }
          return yield* captureOnce(input).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                if (!(yield* indexCorrupt(input.repository))) return yield* error
                yield* Effect.logWarning("rebuilding corrupt snapshot index", {
                  directory: input.repository.gitDirectory,
                  message: error.message,
                })
                yield* reseedIndex(input.repository, input.seed)
                return yield* captureOnce(input)
              }),
            ),
          )
        }),
      ),
    )

    /**
     * Mirror the source repository's info/exclude into a marked block of the
     * store's own file, so one ls-files pass applies both, exactly like listing
     * with the store's rules and then filtering with the source's. Content above
     * the marker, such as patterns from an init template, is kept.
     */
    const syncExcludes = Effect.fnUntraced(function* (repository: Repository, source?: Repository) {
      if (!source || source.gitDirectory === repository.gitDirectory) return
      const target = path.join(repository.commonDirectory, "info", "exclude")
      const [wanted, current] = yield* Effect.all(
        [fs.readFileStringSafe(path.join(source.commonDirectory, "info", "exclude")), fs.readFileStringSafe(target)],
        { concurrency: 2 },
      ).pipe(Effect.orElseSucceed(() => [undefined, undefined] as const))
      const own = (current ?? "").split(excludeMarker)[0]!
      const next = wanted ? `${own}${own && !own.endsWith("\n") ? "\n" : ""}${excludeMarker}${wanted}` : own
      if (next === (current ?? "")) return
      // Concurrent Git processes must never read a partially written file.
      const staged = `${target}.${process.pid}-${Math.random().toString(36).slice(2)}`
      yield* fs
        .writeWithDirs(staged, next)
        .pipe(
          Effect.andThen(fs.rename(staged, target)),
          Effect.ignore,
          Effect.ensuring(fs.remove(staged, { force: true }).pipe(Effect.ignore)),
        )
    })

    /**
     * Only an index Git itself cannot read is rebuilt, decided by exit status rather
     * than by localized messages. Other failures, such as an unreadable worktree
     * file, surface unchanged.
     */
    const indexCorrupt = Effect.fnUntraced(function* (repository: Repository) {
      if (!(yield* fs.existsSafe(sharedIndex(repository)))) return false
      return yield* repositoryOperation("refresh", repository, [
        "ls-files",
        "-z",
        "--",
        literal(".opencode-probe"),
      ]).pipe(
        Effect.as(false),
        Effect.orElseSucceed(() => true),
      )
    })

    const reseedIndex = Effect.fnUntraced(function* (repository: Repository, seed?: Repository) {
      yield* fs.remove(sharedIndex(repository), { force: true }).pipe(Effect.ignore)
      trees.delete(repository.gitDirectory)
      if (!seed) return
      // Seeding keeps the source's stat cache and cache-tree, so recovery does not rehash every tracked file.
      yield* privateIndex(repository, (index) =>
        fs.copyFile(path.join(seed.gitDirectory, "index"), index).pipe(Effect.ignore),
      )
    })

    // Stores created by earlier releases keep the settings they were created with; only OpenCode's own file is rewritten.
    const upgradeConfig = Effect.fnUntraced(function* (repository: Repository) {
      const file = path.join(repository.gitDirectory, snapshotConfigFile)
      const current = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
      if (current === undefined || current === snapshotConfig) return
      // Concurrent Git processes must never read a partially written file.
      const staged = `${file}.${process.pid}-${Math.random().toString(36).slice(2)}`
      yield* fs
        .writeFileString(staged, snapshotConfig)
        .pipe(
          Effect.andThen(fs.rename(staged, file)),
          Effect.ignore,
          Effect.ensuring(fs.remove(staged, { force: true }).pipe(Effect.ignore)),
        )
    })

    // Private indexes left by killed processes; live captures finish long before the cutoff.
    const sweepPrivateIndexes = Effect.fnUntraced(function* (repository: Repository) {
      const cutoff = Date.now() - 60 * 60 * 1000
      const entries = yield* fs.readDirectory(repository.gitDirectory).pipe(Effect.orElseSucceed(() => []))
      yield* Effect.forEach(
        entries.filter((entry) => entry.startsWith(privateIndexPrefix)),
        (entry) =>
          fs.stat(path.join(repository.gitDirectory, entry)).pipe(
            Effect.flatMap((info) =>
              (Option.getOrUndefined(info.mtime)?.getTime() ?? 0) < cutoff
                ? fs.remove(path.join(repository.gitDirectory, entry), { force: true })
                : Effect.void,
            ),
            Effect.ignore,
          ),
        { discard: true },
      )
    })

    const treeFiles = Effect.fn("Git.tree.files")(function* (input: {
      repository: Repository
      from: TreeID
      to: TreeID
    }) {
      // Undo needs both paths of a rename, not only its destination.
      return nuls(
        (yield* repositoryOperation("list_files", input.repository, [
          "diff",
          "--name-only",
          "--no-renames",
          "-z",
          input.from,
          input.to,
        ])).text,
      ).map((file) => RelativePath.make(file))
    })

    /**
     * Three batched invocations over the tree pair instead of three per file. An
     * explicit empty selection diffs nothing; an absent one diffs every changed path.
     * Patch output is capped like VCS diffs: files past the cap get an empty patch.
     */
    const treeDiff = Effect.fn("Git.tree.diff")(function* (input: {
      repository: Repository
      from: TreeID
      to: TreeID
      context?: number
      paths?: readonly RelativePath[]
    }) {
      if (input.paths?.length === 0) return []
      const args = ["--no-renames", input.from, input.to, "--", ...(input.paths ?? []).map(literal)]
      // Patch headers have no -z form: unquoted paths keep chunksByFile matching non-ASCII names.
      const [names, numbers, patch] = yield* Effect.all(
        [
          repositoryOperation("diff", input.repository, ["diff", "--name-status", "-z", ...args]),
          repositoryOperation("diff", input.repository, ["diff", "--numstat", "-z", ...args]),
          repositoryOperation(
            "diff",
            input.repository,
            ["-c", "core.quotepath=false", "diff", "--no-ext-diff", `--unified=${input.context ?? 3}`, ...args],
            { maxOutputBytes: VcsPatch.MAX_TOTAL_PATCH_BYTES },
          ),
        ],
        { concurrency: 3 },
      )
      const statuses = nuls(names.text)
      const files = statuses.flatMap((code, index) => {
        const file = statuses[index + 1]
        if (index % 2 !== 0 || !file) return []
        return [
          {
            file: RelativePath.make(file),
            status: code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified",
          } as const,
        ]
      })
      const stats = new Map(
        nuls(numbers.text).flatMap((line) => {
          const [additions, deletions, ...file] = line.split("\t")
          if (!additions || !deletions || file.length === 0) return []
          return [
            [
              file.join("\t"),
              additions === "-" || deletions === "-"
                ? { binary: true, additions: 0, deletions: 0 }
                : { binary: false, additions: Number(additions), deletions: Number(deletions) },
            ] as const,
          ]
        }),
      )
      const patches = VcsPatch.chunksByFile(patch, (index) => files[index]?.file)
      return files.map((entry) => {
        const stat = stats.get(entry.file)
        return {
          ...entry,
          additions: stat?.additions ?? 0,
          deletions: stat?.deletions ?? 0,
          patch: stat?.binary ? "" : (patches.get(entry.file) ?? VcsPatch.emptyPatch(entry.file)),
        } satisfies FileDiff.Info
      })
    })

    const hasEntry = Effect.fnUntraced(function* (repository: Repository, tree: TreeID, file: RelativePath) {
      const text = (yield* repositoryOperation("restore", repository, [
        "ls-tree",
        "-z",
        tree,
        "--",
        literal(file),
      ])).text.replace(/\0$/, "")
      if (!text) return false
      if (!/^\d+\s+\w+\s+[0-9a-f]+\t/.test(text))
        return yield* new OperationError({
          operation: "restore",
          directory: repository.worktree,
          message: `Invalid tree entry for ${file}`,
        })
      return true
    })

    const removePath = (repository: Repository, file: RelativePath) =>
      fs.remove(path.join(repository.worktree, file), { recursive: true, force: true }).pipe(
        Effect.mapError(
          (cause) =>
            new OperationError({
              operation: "restore",
              directory: repository.worktree,
              message: `Failed to remove ${file}`,
              cause,
            }),
        ),
      )

    /** Paths that have an entry in `tree`, listed in chunks to stay below argument limits. */
    const entries = Effect.fnUntraced(function* (repository: Repository, tree: TreeID, files: readonly RelativePath[]) {
      const chunks = Array.from({ length: Math.ceil(files.length / 512) }, (_, index) =>
        files.slice(index * 512, (index + 1) * 512),
      )
      const listed = yield* Effect.forEach(chunks, (chunk) =>
        repositoryOperation("restore", repository, ["ls-tree", "-z", tree, "--", ...chunk.map(literal)]).pipe(
          Effect.flatMap((result) =>
            Effect.forEach(nuls(result.text), (record) => {
              const match = /^\d+ \w+ [0-9a-f]+\t(.*)$/s.exec(record)
              if (match) return Effect.succeed(match[1])
              return Effect.fail(
                new OperationError({
                  operation: "restore",
                  directory: repository.worktree,
                  message: `Invalid tree entry: ${record}`,
                }),
              )
            }),
          ),
        ),
      )
      return new Set(listed.flat())
    })

    /**
     * Restores path by path in map order, like the original implementation, unless
     * every path is independent. Operations on independent paths commute, so they
     * are batched into one ls-tree and one checkout per source tree instead of two
     * processes per file.
     */
    const restore = Effect.fn("Git.tree.restore")(
      (input: { repository: Repository; files: ReadonlyMap<RelativePath, TreeID> }) =>
        locked(
          input.repository,
          Effect.gen(function* () {
            if (!input.files.size) return
            if (!independent([...input.files.keys()]))
              return yield* Effect.forEach(
                input.files,
                ([file, tree]) =>
                  Effect.gen(function* () {
                    if (!(yield* hasEntry(input.repository, tree, file)))
                      return yield* removePath(input.repository, file)
                    yield* privateIndex(input.repository, (index) =>
                      repositoryOperation("restore", input.repository, ["checkout", tree, "--", literal(file)], {
                        index,
                      }),
                    )
                  }),
                { discard: true },
              )
            const groups = new Map<TreeID, RelativePath[]>()
            input.files.forEach((tree, file) => groups.set(tree, [...(groups.get(tree) ?? []), file]))
            const plan = yield* Effect.forEach(groups, ([tree, files]) =>
              entries(input.repository, tree, files).pipe(
                Effect.map((present) => ({
                  tree,
                  present: files.filter((file) => present.has(file)),
                  absent: files.filter((file) => !present.has(file)),
                })),
              ),
            )
            yield* Effect.forEach(
              plan.flatMap((item) => item.absent),
              (file) => removePath(input.repository, file),
              { concurrency: 16, discard: true },
            )
            const checkouts = plan.filter((item) => item.present.length)
            if (!checkouts.length) return
            yield* privateIndex(input.repository, (index) =>
              Effect.forEach(
                checkouts,
                (item) =>
                  repositoryOperation(
                    "restore",
                    input.repository,
                    ["checkout", item.tree, "--pathspec-from-file=-", "--pathspec-file-nul"],
                    { stdin: item.present.map(literal).join("\0") + "\0", index },
                  ),
                { discard: true },
              ),
            )
          }),
        ),
    )

    /**
     * Snapshot trees have no refs, so Git's own repack and prune would treat every
     * snapshot as garbage. Compaction instead hands pack-objects an explicit list of
     * every loose object (and, when merging, every object in the old packs), checks
     * the new index lists all of them, and only then deletes the loose copies and
     * the merged packs. Nothing is pruned, and objects are never delegated to the
     * source repository through alternates.
     */
    const compact = Effect.fn("Git.objects.compact")(function* (repository: Repository) {
      const objects = path.join(repository.gitDirectory, "objects")
      const packDirectory = path.join(objects, "pack")
      const loose = yield* looseObjects(objects)
      const packs = yield* localPacks(packDirectory)
      const merge = packs.length >= compactPackLimit
      if (loose.length < compactLooseLimit && !merge) return
      yield* compactionLock(
        repository,
        Effect.gen(function* () {
          yield* sweepTemporaryPacks(packDirectory)
          const merged = merge
            ? yield* Effect.forEach(packs, (pack) =>
                packIndex(repository, path.join(packDirectory, `${pack}.idx`)).pipe(
                  Effect.map((oids) => ({ pack, oids })),
                ),
              )
            : []
          const wanted = [...new Set([...loose.map((item) => item.oid), ...merged.flatMap((item) => item.oids)])]
          if (!wanted.length) return
          const written = (yield* repositoryOperation(
            "compact",
            repository,
            [
              "-c",
              "pack.threads=2",
              "-c",
              "pack.windowMemory=64m",
              "pack-objects",
              "-q",
              "--non-empty",
              path.join(packDirectory, "pack"),
            ],
            { stdin: wanted.join("\n") + "\n" },
          )).text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
          const packed = new Set(
            (yield* Effect.forEach(written, (name) =>
              packIndex(repository, path.join(packDirectory, `pack-${name}.idx`)),
            )).flat(),
          )
          const missing = wanted.filter((oid) => !packed.has(oid))
          if (missing.length)
            return yield* new OperationError({
              operation: "compact",
              directory: repository.gitDirectory,
              message: `Packed ${packed.size} objects but ${missing.length} are missing; nothing was removed`,
            })
          // Deletion is quick and must not stop halfway, which could strand a pack without its index.
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* Effect.forEach(loose, (item) => fs.remove(item.file, { force: true }).pipe(Effect.ignore), {
                concurrency: 16,
                discard: true,
              })
              const kept = new Set(written.map((name) => `pack-${name}`))
              yield* Effect.forEach(
                merged.filter((item) => !kept.has(item.pack)),
                (item) =>
                  // The index goes first so readers never see an index without its pack.
                  Effect.forEach(
                    [".idx", ".pack", ".rev", ".bitmap", ".mtimes"],
                    (extension) =>
                      fs
                        .remove(path.join(packDirectory, `${item.pack}${extension}`), { force: true })
                        .pipe(Effect.ignore),
                    { discard: true },
                  ),
                { discard: true },
              )
            }),
          )
        }),
      )
    })

    const looseObjects = Effect.fnUntraced(function* (objects: string) {
      const fanout = (yield* fs.readDirectory(objects).pipe(Effect.orElseSucceed(() => []))).filter((entry) =>
        /^[0-9a-f]{2}$/.test(entry),
      )
      const listed = yield* Effect.forEach(
        fanout,
        (prefix) =>
          fs.readDirectory(path.join(objects, prefix)).pipe(
            Effect.orElseSucceed(() => []),
            Effect.map((entries) =>
              entries
                .filter((entry) => /^[0-9a-f]{38}$|^[0-9a-f]{62}$/.test(entry))
                .map((entry) => ({ oid: prefix + entry, file: path.join(objects, prefix, entry) })),
            ),
          ),
        { concurrency: 16 },
      )
      return listed.flat()
    })

    // Packs with a .keep marker or a promisor file belong to someone else's policy and are left alone.
    const localPacks = Effect.fnUntraced(function* (directory: string) {
      const entries = new Set(yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => [])))
      return [...entries]
        .filter((entry) => entry.startsWith("pack-") && entry.endsWith(".pack"))
        .map((entry) => entry.slice(0, -".pack".length))
        .filter(
          (pack) => entries.has(`${pack}.idx`) && !entries.has(`${pack}.keep`) && !entries.has(`${pack}.promisor`),
        )
    })

    const packIndex = Effect.fnUntraced(function* (repository: Repository, file: string) {
      const bytes = yield* fs.readFile(file).pipe(
        Effect.mapError(
          (cause) =>
            new OperationError({
              operation: "compact",
              directory: repository.gitDirectory,
              message: `Failed to read ${file}`,
              cause,
            }),
        ),
      )
      const result = yield* repositoryOperation("compact", repository, ["show-index"], { stdin: bytes })
      return result.text.split("\n").flatMap((line) => {
        const oid = line.split(" ")[1]
        return oid ? [oid] : []
      })
    })

    /**
     * pack-objects writes tmp_* files and renames them; leftovers mean a killed
     * process. A pack without its index is unreadable to Git, so removing one is
     * lossless; the age cutoff skips a pack whose index is still being renamed.
     */
    const sweepTemporaryPacks = Effect.fnUntraced(function* (directory: string) {
      const cutoff = Date.now() - 60 * 60 * 1000
      const entries = yield* fs.readDirectory(directory).pipe(Effect.orElseSucceed(() => []))
      const indexed = new Set(entries.filter((entry) => entry.endsWith(".idx")).map((entry) => entry.slice(0, -4)))
      yield* Effect.forEach(
        entries.filter(
          (entry) =>
            entry.startsWith("tmp_") ||
            (entry.startsWith("pack-") && entry.endsWith(".pack") && !indexed.has(entry.slice(0, -5))),
        ),
        (entry) =>
          fs.stat(path.join(directory, entry)).pipe(
            Effect.flatMap((info) =>
              (Option.getOrUndefined(info.mtime)?.getTime() ?? 0) < cutoff
                ? fs.remove(path.join(directory, entry), { force: true })
                : Effect.void,
            ),
            Effect.ignore,
          ),
        { discard: true },
      )
    })

    // Cross-process exclusion: concurrent compactions would stay lossless but duplicate work and objects.
    const compactionLock = <A, E, R>(repository: Repository, effect: Effect.Effect<A, E, R>) => {
      const file = path.join(repository.gitDirectory, "opencode-compact.lock")
      return Effect.gen(function* () {
        const stale = yield* fs.stat(file).pipe(
          Effect.map((info) => (Option.getOrUndefined(info.mtime)?.getTime() ?? 0) < Date.now() - 60 * 60 * 1000),
          Effect.orElseSucceed(() => false),
        )
        if (stale) yield* fs.remove(file, { force: true }).pipe(Effect.ignore)
        const acquired = yield* fs.writeFileString(file, String(process.pid), { flag: "wx" }).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        )
        if (!acquired) return
        yield* effect.pipe(Effect.ensuring(fs.remove(file, { force: true }).pipe(Effect.ignore)))
      })
    }

    const worktreeRun = Effect.fnUntraced(function* (
      operation: "create" | "remove" | "list",
      repository: Repository,
      args: string[],
      worktreeDirectory?: AbsolutePath,
      cwd = repository.worktree,
    ) {
      const result = yield* proc
        .run(ChildProcess.make(gitExecutable, args, { cwd, extendEnv: true, stdin: "ignore" }))
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
        write: (repository) => writeTree(repository),
        files: treeFiles,
        diff: treeDiff,
        restore,
      },
      objects: { compact },
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer: layer, deps: [FSUtil.node, AppProcess.node] })

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
      ChildProcess.make(gitExecutable, args, {
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

/** Split NUL-terminated git output into its records. */
function nuls(text: string) {
  return text.split("\0").filter(Boolean)
}

/** Pathspec magic that matches exactly one path, so names with `*`, `?`, `[`, or a leading `:` are not patterns. */
function literal(file: string) {
  return `:(literal)${file}`
}

/**
 * Paths whose restore operations commute: none inside another, and every segment
 * printable ASCII that no platform rewrites. Git precomposes Unicode, filesystems
 * may fold case, and Windows drops trailing dots and spaces and treats `\` and
 * `:` specially, so anything else takes the ordered path.
 */
function independent(files: readonly string[]) {
  const canonical = files.every((file) =>
    file.split("/").every((part) => /^[\x20-\x7e]+$/.test(part) && !/[\\:]/.test(part) && !/[. ]$/.test(part)),
  )
  if (!canonical) return false
  const folded = new Set(files.map((file) => file.toLowerCase()))
  if (folded.size !== files.length) return false
  return files.every((file) => {
    const parts = file.toLowerCase().split("/")
    return parts.slice(1).every((_, index) => !folded.has(parts.slice(0, index + 1).join("/")))
  })
}

function resolvePath(cwd: string, value: string) {
  const trimmed = value.replace(/[\r\n]+$/, "")
  if (!trimmed) return cwd
  const normalized = FSUtil.windowsPath(trimmed)
  if (path.isAbsolute(normalized)) return path.normalize(normalized)
  return path.resolve(cwd, normalized)
}
