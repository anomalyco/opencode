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

const temporaryIndexPrefix = "index.opencode-"
// Like `git gc --auto`, pack once loose objects accumulate, and combine packs before lookups slow down.
// Room below Windows' 32,767-character command line for the Git path, repository flags, and quoting.
const argumentBudget = 24_000
const looseObjectLimit = 2048
const packCountLimit = 16

export interface CaptureInput {
  readonly repository: Repository
  readonly scopes: readonly RelativePath[]
  /**
   * Source repository whose ignore rules decide which paths are recorded. Its index also
   * rebuilds an unreadable snapshot index without rehashing every tracked file.
   */
  readonly ignores?: Repository
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
    "pack",
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
     * Pack loose objects and combine small packs without dropping any object,
     * reachable or not. Returns without work below the thresholds; safe to run
     * concurrently with captures and with other processes.
     */
    readonly pack: (repository: Repository) => Effect.Effect<void, OperationError>
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
     * A new store is initialized in a temporary sibling directory and renamed into
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
        yield* initRepository({ ...input, directory: input.gitDirectory })
        return repository
      }
      const temporaryDirectory = AbsolutePath.make(`${input.gitDirectory}.init-${uniqueSuffix()}`)
      yield* Effect.gen(function* () {
        yield* initRepository({ ...input, directory: temporaryDirectory })
        const renamed = yield* fs.rename(temporaryDirectory, input.gitDirectory).pipe(Effect.exit)
        if (Exit.isSuccess(renamed) || (yield* fs.existsSafe(path.join(input.gitDirectory, "HEAD")))) return
        return yield* new OperationError({
          operation: "create",
          directory: input.gitDirectory,
          message: "Failed to move Git storage into place",
          cause: Cause.squash(renamed.cause),
        })
      }).pipe(Effect.ensuring(fs.remove(temporaryDirectory, { recursive: true, force: true }).pipe(Effect.ignore)))
      return repository
    })

    const initRepository = Effect.fnUntraced(function* (input: {
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
     * Both commands only read the index, so they never take `index.lock`. Two parallel processes beat one combined
     * `ls-files -m -o`, whose lstat pass is not threaded like diff-files'.
     */
    const listChanges = Effect.fnUntraced(function* (repository: Repository, scope: RelativePath, index?: string) {
      const list = (args: string[]) =>
        repositoryOperation("refresh", repository, args, { index }).pipe(
          // Embedded repositories are listed as `dir/`; update-index records them as gitlinks.
          Effect.map((result) => nuls(result.text).map((file) => RelativePath.make(file.replace(/\/$/, "")))),
        )
      const [tracked, untracked] = yield* Effect.all(
        [
          list(["diff-files", "--name-only", "-z", "--", literalPathspec(scope)]),
          list(["ls-files", "--others", "--exclude-standard", "-z", "--", literalPathspec(scope)]),
        ],
        { concurrency: 2 },
      )
      return { tracked, untracked }
    })

    const updateIndex = Effect.fnUntraced(function* (input: {
      repository: Repository
      changes: { tracked: readonly RelativePath[]; untracked: readonly RelativePath[] }
      ignores?: Repository
      maximumUntrackedFileBytes?: number
      index?: string
      excluded?: ReadonlySet<RelativePath>
    }) {
      const candidates = [...input.changes.tracked, ...input.changes.untracked]
      if (!candidates.length) return { skipped: [] }
      const excluded =
        input.excluded ??
        (input.ignores ? yield* ignored({ repository: input.ignores, paths: candidates }) : new Set<RelativePath>())
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
      const added = candidates.filter((item) => !excluded.has(item) && !skip.has(item))
      // Untracked paths are not in the index, so only tracked paths that are now ignored need removing.
      const removed = input.changes.tracked.filter((item) => excluded.has(item))
      // update-index takes literal paths, so large lists avoid add's quadratic pathspec matching.
      if (removed.length)
        yield* repositoryOperation("refresh", input.repository, ["update-index", "--force-remove", "-z", "--stdin"], {
          stdin: removed.join("\0") + "\0",
          index: input.index,
        })
      // update-index drops a tracked file replaced by an embedded repository; a second line for the same path,
      // in the same call, records its gitlink. For a path that already is a gitlink the repeat is a no-op.
      const embedded = (yield* Effect.forEach(
        input.changes.tracked.filter((item) => !excluded.has(item)),
        (item) =>
          fs
            .existsSafe(path.join(input.repository.worktree, item, ".git"))
            .pipe(Effect.map((found) => (found ? item : undefined))),
        { concurrency: 8 },
      )).filter((item): item is RelativePath => item !== undefined)
      if (added.length)
        yield* repositoryOperation(
          "refresh",
          input.repository,
          ["update-index", "--add", "--remove", "--replace", "-z", "--stdin"],
          { stdin: [...added, ...embedded].join("\0") + "\0", index: input.index },
        )
      return { skipped }
    })

    const refresh = Effect.fn("Git.index.refresh")(function* (input: {
      repository: Repository
      scope: RelativePath
      ignores?: Repository
      maximumUntrackedFileBytes?: number
    }) {
      return yield* updateIndex({ ...input, changes: yield* listChanges(input.repository, input.scope) })
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

    const indexFile = (repository: Repository) => path.join(repository.gitDirectory, "index")
    /** Git only replaces an index by renaming a new file into place, so every write changes its inode. */
    const indexFingerprint = (file: string) =>
      fs.stat(file).pipe(
        Effect.map((info) =>
          [Option.getOrUndefined(info.ino), info.size, Option.getOrUndefined(info.mtime)?.getTime()].join(":"),
        ),
        Effect.orElseSucceed(() => undefined),
      )

    /** A copied index must keep the timestamp Git uses to detect racily clean entries. */
    const copyIndex = Effect.fnUntraced(function* (from: string, to: string) {
      const info = yield* fs.stat(from)
      yield* fs.copyFile(from, to)
      const mtime = Option.getOrUndefined(info.mtime)
      if (mtime)
        yield* fs
          .utimes(
            to,
            Option.getOrElse(info.atime, () => mtime),
            mtime,
          )
          .pipe(Effect.ignore)
    })

    /**
     * Run index writes against a temporary index, then rename it over the store's
     * index. Processes never contend on `index.lock`, an interrupted or killed
     * writer cannot leave a partial index behind, and a stale lock is irrelevant.
     * Git never writes an index in place, it writes a lock file and renames it over
     * the temporary name, so a hard-linked temporary index leaves the store's index
     * untouched; a copy is the fallback when linking fails. The index is only a stat
     * cache over the object store; when writers race, the last rename wins and the
     * next capture reconciles against the worktree.
     */
    const withTemporaryIndex = <A, E, R>(repository: Repository, use: (index: string) => Effect.Effect<A, E, R>) =>
      Effect.acquireUseRelease(
        Effect.gen(function* () {
          const current = indexFile(repository)
          const index = temporaryIndex(repository)
          if (!(yield* fs.existsSafe(current))) return index
          const linked = yield* fs.link(current, index).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          )
          if (linked) return index
          yield* copyIndex(current, index).pipe(
            Effect.mapError(
              (cause) =>
                new OperationError({
                  operation: "refresh",
                  directory: repository.gitDirectory,
                  message: "Failed to prepare a temporary index",
                  cause,
                }),
            ),
          )
          return index
        }),
        (index) =>
          Effect.gen(function* () {
            const value = yield* use(index)
            const installed = yield* Effect.uninterruptible(
              Effect.gen(function* () {
                // Fingerprint before the rename, so a concurrent writer's index can never be paired with this tree.
                const fingerprint = yield* indexFingerprint(index)
                const renamed = yield* fs.rename(index, indexFile(repository)).pipe(
                  // Windows reports a transient sharing violation while another process reads the index.
                  Effect.retry({ times: 3, schedule: Schedule.spaced("20 millis") }),
                  Effect.as(true),
                  Effect.orElseSucceed(() => false),
                )
                return renamed ? fingerprint : undefined
              }),
            )
            return { value, installed }
          }),
        (index) => fs.remove(index, { force: true }).pipe(Effect.ignore),
      )

    // A clean capture returns the tree last written from the exact index it scanned.
    const lastCaptures = new Map<string, { readonly fingerprint: string; readonly tree: TreeID }>()
    const preparedStores = new Set<string>()

    /**
     * Changes are listed against the temporary index they are written to, never the
     * store's index, which another process may replace at any moment. Each tree is
     * therefore exactly its own index plus the worktree changes against it.
     */
    const attemptCapture = Effect.fnUntraced(function* (input: CaptureInput) {
      const result = yield* withTemporaryIndex(input.repository, (index) =>
        Effect.gen(function* () {
          const scanned = yield* indexFingerprint(index)
          const changes = yield* Effect.forEach(input.scopes, (scope) => listChanges(input.repository, scope, index), {
            concurrency: "unbounded",
          })
          const last = lastCaptures.get(input.repository.gitDirectory)
          const untracked = changes.flatMap((change) => change.untracked)
          // Paths the source ignores are listed as untracked on every scan; they leave the index unchanged.
          const excluded =
            scanned && last?.fingerprint === scanned && changes.every((change) => !change.tracked.length)
              ? input.ignores
                ? yield* ignored({ repository: input.ignores, paths: untracked })
                : new Set<RelativePath>()
              : undefined
          if (last && excluded && untracked.every((file) => excluded.has(file))) return last.tree
          yield* Effect.forEach(changes, (change) => updateIndex({ ...input, changes: change, index, excluded }), {
            discard: true,
          })
          return yield* writeTree(input.repository, index)
        }),
      )
      if (result.installed)
        lastCaptures.set(input.repository.gitDirectory, { fingerprint: result.installed, tree: result.value })
      if (!result.installed) lastCaptures.delete(input.repository.gitDirectory)
      return result.value
    })

    const captureTree = Effect.fn("Git.tree.capture")((input: CaptureInput) =>
      locked(
        input.repository,
        Effect.gen(function* () {
          if (!preparedStores.has(input.repository.gitDirectory)) {
            preparedStores.add(input.repository.gitDirectory)
            yield* sweepTemporaryIndexes(input.repository)
            yield* ensureSnapshotConfig(input.repository)
          }
          return yield* attemptCapture(input).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                if (!(yield* isIndexUnreadable(input.repository))) return yield* error
                yield* Effect.logWarning("rebuilding unreadable snapshot index", {
                  directory: input.repository.gitDirectory,
                  message: error.message,
                })
                yield* rebuildIndex(input.repository, input.ignores)
                return yield* attemptCapture(input)
              }),
            ),
          )
        }),
      ),
    )

    /**
     * Only an index Git itself cannot read is rebuilt, decided by exit status rather
     * than by localized messages. Other failures, such as an unreadable worktree
     * file or a process that could not start, surface unchanged.
     */
    const isIndexUnreadable = Effect.fnUntraced(function* (repository: Repository) {
      if (!(yield* fs.existsSafe(indexFile(repository)))) return false
      return yield* repositoryOperation("refresh", repository, [
        "ls-files",
        "-z",
        "--",
        literalPathspec(".opencode-probe"),
      ]).pipe(Effect.match({ onSuccess: () => false, onFailure: (error) => error.cause === undefined }))
    })

    const rebuildIndex = Effect.fnUntraced(function* (repository: Repository, source?: Repository) {
      lastCaptures.delete(repository.gitDirectory)
      const temporary = temporaryIndex(repository)
      // The source's stat cache and cache-tree spare recovery from rehashing every tracked file.
      const copied = source
        ? yield* copyIndex(path.join(source.gitDirectory, "index"), temporary).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          )
        : false
      yield* (
        copied ? fs.rename(temporary, indexFile(repository)) : fs.remove(indexFile(repository), { force: true })
      ).pipe(Effect.ignore, Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)))
    })

    // Stores created by earlier releases would otherwise keep their original settings; only OpenCode's include file is rewritten, never `config`.
    const ensureSnapshotConfig = Effect.fnUntraced(function* (repository: Repository) {
      const file = path.join(repository.gitDirectory, snapshotConfigFile)
      const current = yield* fs.readFileStringSafe(file).pipe(Effect.orElseSucceed(() => undefined))
      if (current === undefined || current === snapshotConfig) return
      // Concurrent Git processes must never read a partially written file.
      const temporary = `${file}.${uniqueSuffix()}`
      yield* fs
        .writeFileString(temporary, snapshotConfig)
        .pipe(
          Effect.andThen(fs.rename(temporary, file)),
          Effect.ignore,
          Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
        )
    })

    const temporaryIndex = (repository: Repository) =>
      path.join(repository.gitDirectory, `${temporaryIndexPrefix}${Date.now()}-${uniqueSuffix()}`)

    /**
     * Temporary indexes left by killed processes. Age comes from the creation time in
     * the name, because a hard-linked index keeps the store index's old mtime; live
     * captures finish long before the cutoff.
     */
    const sweepTemporaryIndexes = Effect.fnUntraced(function* (repository: Repository) {
      const cutoff = Date.now() - 60 * 60 * 1000
      const entries = yield* fs.readDirectory(repository.gitDirectory).pipe(Effect.orElseSucceed(() => []))
      yield* Effect.forEach(
        entries.filter(
          (entry) =>
            entry.startsWith(temporaryIndexPrefix) &&
            Number(entry.slice(temporaryIndexPrefix.length).split("-")[0]) < cutoff,
        ),
        (entry) => fs.remove(path.join(repository.gitDirectory, entry), { force: true }).pipe(Effect.ignore),
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
     * A selection too long for one Windows command line is diffed in groups that
     * share the patch cap; Git orders output by path, so the groups concatenate in
     * the order a single call would produce.
     */
    const treeDiff = Effect.fn("Git.tree.diff")(function* (input: {
      repository: Repository
      from: TreeID
      to: TreeID
      context?: number
      paths?: readonly RelativePath[]
    }) {
      if (input.paths?.length === 0) return []
      const groups = input.paths ? pathGroups(input.paths) : [undefined]
      const diffs: FileDiff.Info[] = []
      let patchBudget = VcsPatch.MAX_TOTAL_PATCH_BYTES
      for (const paths of groups) {
        const group = yield* diffGroup({ ...input, paths }, patchBudget)
        diffs.push(...group.diffs)
        patchBudget = group.truncated ? 0 : patchBudget - group.patchBytes
      }
      return diffs
    })

    const diffGroup = Effect.fnUntraced(function* (
      input: { repository: Repository; from: TreeID; to: TreeID; context?: number; paths?: readonly RelativePath[] },
      patchBudget: number,
    ) {
      const args = ["--no-renames", input.from, input.to, "--", ...(input.paths ?? [])]
      // Patch headers have no -z form: unquoted paths keep chunksByFile matching non-ASCII names.
      const [names, numbers, patch] = yield* Effect.all(
        [
          repositoryOperation("diff", input.repository, [
            "--literal-pathspecs",
            "diff",
            "--name-status",
            "-z",
            ...args,
          ]),
          repositoryOperation("diff", input.repository, ["--literal-pathspecs", "diff", "--numstat", "-z", ...args]),
          patchBudget > 0
            ? repositoryOperation(
                "diff",
                input.repository,
                [
                  "--literal-pathspecs",
                  "-c",
                  "core.quotepath=false",
                  "diff",
                  "--no-ext-diff",
                  `--unified=${input.context ?? 3}`,
                  ...args,
                ],
                { maxOutputBytes: patchBudget },
              )
            : Effect.succeed({ text: "", stderr: "", truncated: true }),
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
      return {
        diffs: files.map((entry) => {
          const stat = stats.get(entry.file)
          return {
            ...entry,
            additions: stat?.additions ?? 0,
            deletions: stat?.deletions ?? 0,
            patch: stat?.binary ? "" : (patches.get(entry.file) ?? VcsPatch.emptyPatch(entry.file)),
          } satisfies FileDiff.Info
        }),
        patchBytes: Buffer.byteLength(patch.text),
        truncated: patch.truncated,
      }
    })

    const hasEntry = Effect.fnUntraced(function* (repository: Repository, tree: TreeID, file: RelativePath) {
      const text = (yield* repositoryOperation("restore", repository, [
        "ls-tree",
        "-z",
        tree,
        "--",
        literalPathspec(file),
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

    /**
     * One ls-tree per tree. Windows caps a command line at 32,767 characters, so a
     * selection too long to pass as arguments lists the whole tree instead.
     */
    const pathsInTree = Effect.fnUntraced(function* (
      repository: Repository,
      tree: TreeID,
      files: readonly RelativePath[],
    ) {
      const pathspecs = files.map(literalPathspec)
      const fits = pathspecs.reduce((length, pathspec) => length + pathspec.length + 1, 0) <= argumentBudget
      const result = yield* repositoryOperation(
        "restore",
        repository,
        fits ? ["ls-tree", "-z", tree, "--", ...pathspecs] : ["ls-tree", "-r", "-t", "-z", "--full-tree", tree],
      )
      const listed = yield* Effect.forEach(nuls(result.text), (record) => {
        const match = /^\d+ \w+ [0-9a-f]+\t(.*)$/s.exec(record)
        if (match) return Effect.succeed(RelativePath.make(match[1]!))
        return Effect.fail(
          new OperationError({
            operation: "restore",
            directory: repository.worktree,
            message: `Invalid tree entry: ${record}`,
          }),
        )
      })
      return new Set(listed)
    })

    /** Batched paths cost one ls-tree and one checkout per source tree instead of two processes per file. */
    const restore = Effect.fn("Git.tree.restore")(
      (input: { repository: Repository; files: ReadonlyMap<RelativePath, TreeID> }) =>
        locked(
          input.repository,
          Effect.gen(function* () {
            if (!input.files.size) return
            if (!canBatchRestore([...input.files.keys()]))
              return yield* Effect.forEach(
                input.files,
                ([file, tree]) =>
                  Effect.gen(function* () {
                    if (!(yield* hasEntry(input.repository, tree, file)))
                      return yield* removePath(input.repository, file)
                    yield* withTemporaryIndex(input.repository, (index) =>
                      repositoryOperation(
                        "restore",
                        input.repository,
                        ["checkout", tree, "--", literalPathspec(file)],
                        {
                          index,
                        },
                      ),
                    )
                  }),
                { discard: true },
              )
            const groups = new Map<TreeID, RelativePath[]>()
            input.files.forEach((tree, file) => groups.set(tree, [...(groups.get(tree) ?? []), file]))
            const plan = yield* Effect.forEach(groups, ([tree, files]) =>
              pathsInTree(input.repository, tree, files).pipe(
                Effect.map((present) => ({
                  tree,
                  present: files.filter((file) => present.has(file)),
                  absent: files.filter((file) => !present.has(file)),
                })),
              ),
            )
            // Checkouts go first, so one failing removal cannot stop the other files from being restored.
            const checkouts = plan.filter((item) => item.present.length)
            if (checkouts.length)
              yield* withTemporaryIndex(input.repository, (index) =>
                Effect.forEach(
                  checkouts,
                  (item) =>
                    repositoryOperation(
                      "restore",
                      input.repository,
                      ["checkout", item.tree, "--pathspec-from-file=-", "--pathspec-file-nul"],
                      { stdin: item.present.map(literalPathspec).join("\0") + "\0", index },
                    ),
                  { discard: true },
                ),
              )
            yield* Effect.forEach(
              plan.flatMap((item) => item.absent),
              (file) => removePath(input.repository, file),
              { concurrency: 16, discard: true },
            )
          }),
        ),
    )

    /**
     * Snapshot trees have no refs, so Git's own repack and prune would treat every
     * snapshot as garbage. Packing instead hands pack-objects an explicit list of
     * every loose object (and, when combining, every object in the old packs), checks
     * the new index lists all of them, and only then deletes the loose copies and
     * the combined packs. Nothing is pruned, and objects are never delegated to the
     * source repository through alternates.
     */
    const packObjects = Effect.fn("Git.objects.pack")(function* (repository: Repository) {
      const objects = path.join(repository.gitDirectory, "objects")
      const packDirectory = path.join(objects, "pack")
      const loose = yield* looseObjects(objects)
      const packs = yield* localPacks(packDirectory)
      const combinePacks = packs.length >= packCountLimit
      if (loose.length < looseObjectLimit && !combinePacks) return
      yield* withPackLock(
        repository,
        Effect.gen(function* () {
          yield* sweepTemporaryPacks(packDirectory)
          const combined = combinePacks
            ? yield* Effect.forEach(packs, (pack) =>
                packIndex(repository, path.join(packDirectory, `${pack}.idx`)).pipe(
                  Effect.map((oids) => ({ pack, oids })),
                ),
              )
            : []
          const objectIds = [...new Set([...loose.map((item) => item.oid), ...combined.flatMap((item) => item.oids)])]
          if (!objectIds.length) return
          const newPacks = (yield* repositoryOperation(
            "pack",
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
            { stdin: objectIds.join("\n") + "\n" },
          )).text
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
          const packedIds = new Set(
            (yield* Effect.forEach(newPacks, (name) =>
              packIndex(repository, path.join(packDirectory, `pack-${name}.idx`)),
            )).flat(),
          )
          const missing = objectIds.filter((oid) => !packedIds.has(oid))
          if (missing.length)
            return yield* new OperationError({
              operation: "pack",
              directory: repository.gitDirectory,
              message: `Packed ${packedIds.size} objects but ${missing.length} are missing; nothing was removed`,
            })
          // Deletion is quick and must not stop halfway, which could strand a pack without its index.
          yield* Effect.uninterruptible(
            Effect.gen(function* () {
              yield* Effect.forEach(loose, (item) => fs.remove(item.file, { force: true }).pipe(Effect.ignore), {
                concurrency: 16,
                discard: true,
              })
              const newPackNames = new Set(newPacks.map((name) => `pack-${name}`))
              yield* Effect.forEach(
                combined.filter((item) => !newPackNames.has(item.pack)),
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
              operation: "pack",
              directory: repository.gitDirectory,
              message: `Failed to read ${file}`,
              cause,
            }),
        ),
      )
      const parsed = packIndexObjectIDs(bytes)
      if (parsed) return parsed
      const result = yield* repositoryOperation("pack", repository, ["show-index"], { stdin: bytes })
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

    // Cross-process exclusion: concurrent packing would stay lossless but duplicate work and objects.
    const withPackLock = <A, E, R>(repository: Repository, effect: Effect.Effect<A, E, R>) => {
      const file = path.join(repository.gitDirectory, "opencode-pack.lock")
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
      objects: { pack: packObjects },
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
function literalPathspec(file: string) {
  return `:(literal)${file}`
}

/**
 * Paths whose restore operations commute: none inside another, and every segment
 * printable ASCII that no platform rewrites. Git precomposes Unicode, filesystems
 * may fold case, and Windows drops trailing dots and spaces and treats `\` and
 * `:` specially, so anything else takes the ordered path.
 */
function canBatchRestore(files: readonly string[]) {
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

/**
 * Object IDs from a version 2 pack index: magic, version, a 256-entry fan-out
 * table whose last entry is the object count, then the sorted IDs. Returns
 * undefined for version 1 indexes and for packs with 64-bit offsets (over 2 GiB),
 * whose hash length this size check cannot derive.
 */
function packIndexObjectIDs(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 1032 || view.getUint32(0) !== 0xff744f63 || view.getUint32(4) !== 2) return undefined
  const count = view.getUint32(8 + 255 * 4)
  const hash = (bytes.length - 1032 - 8 * count) / (count + 2)
  if (hash !== 20 && hash !== 32) return undefined
  return Array.from({ length: count }, (_, index) =>
    Buffer.from(bytes.subarray(1032 + index * hash, 1032 + (index + 1) * hash)).toString("hex"),
  )
}

/**
 * Windows caps a command line at 32,767 characters; elsewhere one call takes any
 * selection. Groups are sorted by bytes, the order Git prints paths in, and each
 * path is counted with room for the quotes Windows adds around spaces.
 */
function pathGroups(paths: readonly RelativePath[]) {
  if (process.platform !== "win32") return [paths]
  return paths
    .toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)))
    .reduce<{ groups: RelativePath[][]; length: number }>(
      (state, file) => {
        const cost = file.length + 3
        const current = state.groups.at(-1)
        if (current && state.length + cost <= argumentBudget) {
          current.push(file)
          return { groups: state.groups, length: state.length + cost }
        }
        return { groups: [...state.groups, [file]], length: cost }
      },
      { groups: [], length: 0 },
    ).groups
}

function uniqueSuffix() {
  return `${process.pid}-${Math.random().toString(36).slice(2)}`
}

function resolvePath(cwd: string, value: string) {
  const trimmed = value.replace(/[\r\n]+$/, "")
  if (!trimmed) return cwd
  const normalized = FSUtil.windowsPath(trimmed)
  if (path.isAbsolute(normalized)) return path.normalize(normalized)
  return path.resolve(cwd, normalized)
}
