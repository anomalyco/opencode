import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Cause, Deferred, Duration, Effect, Layer, Schedule, Schema, Semaphore, Context, Option } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import { AppProcess } from "@opencode-ai/core/process"
import { InstanceState } from "@/effect/instance-state"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Hash } from "@opencode-ai/core/util/hash"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { Config } from "@/config/config"
import { Global } from "@opencode-ai/core/global"
import { Info } from "@opencode-ai/schema/file-diff"
import os from "os"

export const Patch = Schema.Struct({
  hash: Schema.String,
  files: Schema.mutable(Schema.Array(Schema.String)),
})
export type Patch = typeof Patch.Type

export const FileDiff = Info
export type FileDiff = typeof FileDiff.Type

const prune = "7.days"
const limit = 2 * 1024 * 1024
const core = ["-c", "core.longpaths=true", "-c", "core.symlinks=true"]
const cfg = ["-c", "core.autocrlf=false", ...core]
const quote = [...cfg, "-c", "core.quotepath=false"]
interface GitResult {
  readonly code: ChildProcessSpawner.ExitCode
  readonly text: string
  readonly stderr: string
}

type TransactionToken = {
  readonly pid: number
  readonly hostname: string
  readonly createdAt: number
}

type State = Omit<Interface, "init">

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly cleanup: () => Effect.Effect<void>
  readonly track: () => Effect.Effect<string | undefined>
  readonly patch: (hash: string, options?: { to?: string }) => Effect.Effect<Patch>
  readonly restore: (snapshot: string) => Effect.Effect<boolean>
  readonly revert: (patches: Patch[]) => Effect.Effect<boolean>
  readonly diff: (hash: string) => Effect.Effect<string>
  readonly diffFull: (
    from: string,
    to: string,
    previous?: { to: string; diffs: FileDiff[] },
  ) => Effect.Effect<FileDiff[] | undefined>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Snapshot") {}

const layer: Layer.Layer<Service, never, FSUtil.Service | AppProcess.Service | Config.Service | EffectFlock.Service> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const appProcess = yield* AppProcess.Service
      const config = yield* Config.Service
      const flock = yield* EffectFlock.Service

      const state = yield* InstanceState.make<State>(
        Effect.fn("Snapshot.state")(function* (ctx) {
          const state = {
            directory: ctx.directory,
            worktree: ctx.worktree,
            gitdir: path.join(Global.Path.data, "snapshot", ctx.project.id, Hash.fast(ctx.worktree)),
            vcs: ctx.project.vcs,
          }

          const args = (cmd: string[]) => ["--git-dir", state.gitdir, "--work-tree", state.worktree, ...cmd]

          const encodeNulTerminatedPaths = (files: string[]) => files.join("\0") + "\0"
          const encodeTopLevelLiteralPathspecs = (files: string[]) =>
            encodeNulTerminatedPaths(files.map((file) => `:(top,literal)${file}`))

          const indexLock = path.join(state.gitdir, "index.lock")
          const transactionToken = path.join(state.gitdir, "snapshot-transaction-token")
          const hostname = os.hostname()
          const isIndexLockContention = (result: GitResult) =>
            result.code !== 0 && result.stderr.includes(`Unable to create '${indexLock}': File exists.`)

          const indexLockAge = Effect.fnUntraced(function* () {
            const stat = yield* fs.stat(indexLock).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!stat) return undefined
            return Math.max(0, Date.now() - Option.getOrElse(stat.mtime, () => new Date(0)).getTime())
          })

          // Git retries immediately without a schedule. Native lock ownership is unknown, so retry briefly, diagnose, never delete.
          const indexLockRetry = Schedule.exponential(25, 1.5).pipe(
            Schedule.either(Schedule.spaced(250)),
            Schedule.jittered,
            Schedule.while((meta) => meta.elapsed < 2_000),
          )
          const snapshotGitEnv = (env?: Record<string, string>) => ({ ...env, LC_ALL: "C", LANG: "C" })

          // A corrupt index can silently produce the git empty tree for a non-empty worktree.
          const isSnapshotEmptyTree = (hash: string) =>
            hash === "4b825dc642cb6eb9a060e54bf8d69288fbee4904" ||
            hash === "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321"

          const git = Effect.fnUntraced(function* (
            cmd: string[],
            opts?: { cwd?: string; env?: Record<string, string>; stdin?: string },
          ) {
            const writesIndex = ["add", "rm", "read-tree"].some((subcommand) => cmd.includes(subcommand))
            // Deleting a corrupt index is only safe ahead of commands that rebuild state from the worktree.
            const healsIndex = writesIndex || ["diff-files", "ls-files"].some((subcommand) => cmd.includes(subcommand))
            const execute = Effect.suspend(() =>
              Effect.gen(function* () {
                if (writesIndex && (yield* exists(indexLock))) {
                  return {
                    code: ChildProcessSpawner.ExitCode(128),
                    text: "",
                    stderr: `fatal: Unable to create '${indexLock}': File exists.`,
                  } satisfies GitResult
                }
                return yield* appProcess
                  .run(
                    ChildProcess.make("git", cmd, { cwd: opts?.cwd, env: snapshotGitEnv(opts?.env), extendEnv: true }),
                    {
                      stdin: opts?.stdin,
                    },
                  )
                  .pipe(
                    Effect.map(
                      (result) =>
                        ({
                          code: ChildProcessSpawner.ExitCode(result.exitCode),
                          text: result.stdout.toString("utf8"),
                          stderr: result.stderr.toString("utf8"),
                        }) satisfies GitResult,
                    ),
                    Effect.catch((err) =>
                      Effect.succeed({
                        code: ChildProcessSpawner.ExitCode(1),
                        text: "",
                        stderr: err instanceof Error ? err.message : String(err),
                      }),
                    ),
                  )
              }),
            )

            const settle = (effect: typeof execute) =>
              effect.pipe(
                Effect.flatMap((result) =>
                  isIndexLockContention(result) ? Effect.fail(result) : Effect.succeed(result),
                ),
                Effect.retry({ schedule: indexLockRetry, while: isIndexLockContention }),
                Effect.catch((result) =>
                  Effect.gen(function* () {
                    if (isIndexLockContention(result)) {
                      const ageMs = yield* indexLockAge()
                      yield* Effect.logError("snapshot_index_lock_stuck", {
                        indexLock,
                        ageMs,
                        remedy: "remove the lock manually only after confirming no git process owns it",
                      })
                      yield* Effect.sync(() =>
                        process.stderr.write(
                          `snapshot_index_lock_stuck index_lock=${indexLock} age_ms=${ageMs ?? "unknown"} remedy=manual-confirm-and-remove\n`,
                        ),
                      )
                    }
                    return result
                  }),
                ),
              )

            return yield* settle(execute).pipe(
              Effect.flatMap((outcome) => {
                const corrupted =
                  outcome.code !== 0 &&
                  healsIndex &&
                  /index file corrupt|index file smaller than expected|bad index file sha1 signature|unexpected diff status|unknown file mode for .* in index/.test(
                    outcome.stderr,
                  )
                if (!corrupted) return Effect.succeed(outcome)
                return Effect.gen(function* () {
                  const removed = yield* fs.remove(path.join(state.gitdir, "index")).pipe(
                    Effect.as(true),
                    Effect.catch(() => Effect.succeed(false)),
                  )
                  if (!removed) {
                    yield* Effect.logWarning("snapshot_index_corruption_detected", { gitdir: state.gitdir })
                  }
                  const result = yield* settle(execute)
                  if (removed && result.code === 0) {
                    yield* Effect.logWarning("snapshot_index_corruption_recovered", { gitdir: state.gitdir })
                  }
                  return result
                })
              }),
            )
          })

          const ignore = Effect.fnUntraced(function* (files: string[]) {
            if (!files.length) return new Set<string>()
            // check-ignore treats a leading colon as pathspec magic but accepts and echoes a protective ./ prefix.
            const checkIgnorePaths = files.map((item) => (item.startsWith(":") ? `./${item}` : item))
            const check = yield* git(
              [
                ...quote,
                "--git-dir",
                path.join(state.worktree, ".git"),
                "--work-tree",
                state.worktree,
                "check-ignore",
                "--no-index",
                "--stdin",
                "-z",
              ],
              {
                cwd: state.worktree,
                stdin: encodeNulTerminatedPaths(checkIgnorePaths),
              },
            )
            if (check.code !== 0 && check.code !== 1) return new Set<string>()
            return new Set(
              check.text
                .split("\0")
                .filter(Boolean)
                .map((item) => (item.startsWith("./:") ? item.slice(2) : item)),
            )
          })

          const drop = Effect.fnUntraced(function* (files: string[]) {
            if (!files.length) return true
            const result = yield* git(
              [
                ...cfg,
                ...args(["rm", "--cached", "-f", "--ignore-unmatch", "--pathspec-from-file=-", "--pathspec-file-nul"]),
              ],
              {
                cwd: state.worktree,
                stdin: encodeTopLevelLiteralPathspecs(files),
              },
            )
            if (result.code === 0) return true
            yield* Effect.logError("failed to remove ignored snapshot files", {
              exitCode: result.code,
              stderr: result.stderr,
            })
            return false
          })

          const stage = Effect.fnUntraced(function* (files: string[]) {
            if (!files.length) return true
            const result = yield* git(
              [...cfg, ...args(["add", "--all", "--sparse", "--pathspec-from-file=-", "--pathspec-file-nul"])],
              {
                cwd: state.worktree,
                stdin: encodeTopLevelLiteralPathspecs(files),
              },
            )
            if (result.code === 0) return true
            yield* Effect.logError("failed to add snapshot files", {
              exitCode: result.code,
              stderr: result.stderr,
            })
            return false
          })

          const exists = (file: string) => fs.exists(file).pipe(Effect.orDie)
          const read = (file: string) => fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed("")))
          const remove = (file: string) => fs.remove(file).pipe(Effect.catch(() => Effect.void))
          // Per-instance so the semaphore for a worktree is released with the instance
          // instead of accumulating in a layer-scoped map for every worktree ever opened.
          const locks = new Map<string, Semaphore.Semaphore>()
          const lock = (key: string) => {
            const hit = locks.get(key)
            if (hit) return hit
            const next = Semaphore.makeUnsafe(1)
            locks.set(key, next)
            return next
          }
          // The key uses the XDG-data gitdir while EffectFlock owns XDG-state lock files, so roots stay intentionally independent.
          // Snapshot transactions are non-reentrant: nested acquisition could self-deadlock on the local semaphore.
          const locked = <A, E, R>(fx: Effect.Effect<A, E, R>) =>
            lock(state.gitdir).withPermits(1)(fx.pipe(flock.withLock(`snapshot:${state.gitdir}`)))
          // git gc provides its own cross-process gc.pid coordination, so cleanup must not wait on a stalled snapshot flock.
          const lockedLocal = <A, E, R>(fx: Effect.Effect<A, E, R>) => lock(state.gitdir).withPermits(1)(fx)
          const safeLocked = <A, E, R>(operation: string, fallback: A, fx: Effect.Effect<A, E, R>) =>
            locked(fx).pipe(
              Effect.sandbox,
              Effect.catch((cause) =>
                Effect.logError("snapshot transaction lock failed", {
                  operation,
                  gitdir: state.gitdir,
                  cause: Cause.pretty(cause),
                }).pipe(Effect.as(fallback)),
              ),
            )
          // Read-only operations diff committed, immutable trees (`git diff <tree>`,
          // `show`, `cat-file`, `check-ignore --no-index`) and never touch
          // `$GIT_DIR/index`, so they take neither the per-gitdir semaphore nor the
          // cross-process flock. Holding the write lock here serialized every parallel
          // agent's `track()`/`patch()` behind a diff.
          const safeRead = <A, E, R>(operation: string, fallback: A, fx: Effect.Effect<A, E, R>) =>
            fx.pipe(
              Effect.sandbox,
              Effect.catch((cause) =>
                Effect.logError("snapshot read failed", {
                  operation,
                  gitdir: state.gitdir,
                  cause: Cause.pretty(cause),
                }).pipe(Effect.as(fallback)),
              ),
            )
          const parseTransactionToken = (content: string): TransactionToken | undefined => {
            try {
              const parsed: unknown = JSON.parse(content)
              if (
                !parsed ||
                typeof parsed !== "object" ||
                !("pid" in parsed) ||
                !("hostname" in parsed) ||
                !("createdAt" in parsed) ||
                typeof parsed.pid !== "number" ||
                !Number.isInteger(parsed.pid) ||
                parsed.pid <= 0 ||
                typeof parsed.hostname !== "string" ||
                typeof parsed.createdAt !== "number" ||
                !Number.isFinite(parsed.createdAt)
              ) {
                return undefined
              }
              return parsed as TransactionToken
            } catch {
              return undefined
            }
          }
          const isProvablyDeadLocalPid = (pid: number) => {
            if (pid === process.pid) return false
            try {
              process.kill(pid, 0)
              return false
            } catch (error) {
              return (error as NodeJS.ErrnoException).code === "ESRCH"
            }
          }
          const removeTransactionToken = () =>
            fs.remove(transactionToken).pipe(
              Effect.as(true),
              Effect.catch(() => Effect.succeed(false)),
            )
          const withTransactionToken = <A, E, R>(fx: Effect.Effect<A, E, R>) =>
            Effect.gen(function* () {
              if (yield* exists(transactionToken)) {
                const owner = parseTransactionToken(yield* read(transactionToken))
                if (owner && owner.hostname === hostname && isProvablyDeadLocalPid(owner.pid)) {
                  const removed = yield* removeTransactionToken()
                  if (removed) {
                    yield* Effect.logInfo("snapshot_transaction_token_reclaimed", {
                      pid: owner.pid,
                      hostname: owner.hostname,
                      createdAt: owner.createdAt,
                      ageMs: Math.max(0, Date.now() - owner.createdAt),
                    })
                  }
                }
                if (yield* exists(transactionToken)) {
                  yield* Effect.logError("snapshot_transaction_overlap", {
                    token: transactionToken,
                    owner,
                    remedy: "inspect the token and remove it only after confirming its owner is dead",
                  })
                  return undefined
                }
              }
              const created = yield* fs
                .writeFileString(
                  transactionToken,
                  JSON.stringify({ pid: process.pid, hostname, createdAt: Date.now() }),
                  {
                    flag: "wx",
                  },
                )
                .pipe(
                  Effect.as(true),
                  Effect.catch(() => Effect.succeed(false)),
                )
              if (!created) {
                yield* Effect.logError("snapshot_transaction_overlap", {
                  token: transactionToken,
                  owner: parseTransactionToken(yield* read(transactionToken)),
                  remedy: "inspect the token and remove it only after confirming its owner is dead",
                })
                return undefined
              }
              return yield* fx.pipe(Effect.ensuring(removeTransactionToken().pipe(Effect.asVoid)))
            })

          const enabled = Effect.fnUntraced(function* () {
            if (state.vcs !== "git") return false
            return (yield* config.get()).snapshot !== false
          })

          const excludes = Effect.fnUntraced(function* () {
            const result = yield* git(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], {
              cwd: state.worktree,
            })
            const file = result.text.trim()
            if (!file) return
            if (!(yield* exists(file))) return
            return file
          })

          const sync = Effect.fnUntraced(function* (list: string[] = []) {
            const file = yield* excludes()
            const target = path.join(state.gitdir, "info", "exclude")
            const text = [
              file ? (yield* read(file)).trimEnd() : "",
              ...list.map((item) => `/${item.replaceAll("\\", "/")}`),
            ]
              .filter(Boolean)
              .join("\n")
            yield* fs.ensureDir(path.join(state.gitdir, "info")).pipe(Effect.orDie)
            yield* fs.writeFileString(target, text ? `${text}\n` : "").pipe(Effect.orDie)
          })

          // Reuse the hashes for the git storage between the original repo and snapshot
          // on huge repos like chromium checkout the git add --all rebuilding the
          // hashes can take minutes. By doing this we eliminating this at all
          const seed = Effect.fnUntraced(function* (sourceFormat?: string) {
            if (state.vcs !== "git") return

            const commonDir = yield* git(["rev-parse", "--path-format=absolute", "--git-common-dir"], {
              cwd: state.worktree,
            })

            if (commonDir.code !== 0) return
            const source = commonDir.text.trim()
            if (!source || !(yield* exists(source))) return

            // Share the source object database (and the source's own alternates,
            // skipping any that no longer exist) so seeded blobs resolve.
            const sourceObjects = path.join(source, "objects")
            const chained = (yield* read(path.join(sourceObjects, "info", "alternates")))
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean)
            const alternates: string[] = []
            for (const candidate of [sourceObjects, ...chained]) {
              if (yield* exists(candidate)) alternates.push(candidate)
            }
            if (!alternates.length) return

            yield* fs.ensureDir(path.join(state.gitdir, "objects", "info")).pipe(Effect.orDie)
            yield* fs
              .writeFileString(path.join(state.gitdir, "objects", "info", "alternates"), alternates.join("\n") + "\n")
              .pipe(Effect.orDie)

            const targetFormat = yield* git(["--git-dir", state.gitdir, "rev-parse", "--show-object-format"])
            const snapshotFormat = targetFormat.code === 0 ? targetFormat.text.trim() : undefined
            // A source index is only valid in a snapshot with the same object format; otherwise add rebuilds it safely.
            const sourceIndex = path.join(source, "index")
            if (sourceFormat && snapshotFormat && sourceFormat === snapshotFormat && (yield* exists(sourceIndex))) {
              yield* fs.copyFile(sourceIndex, path.join(state.gitdir, "index")).pipe(Effect.catch(() => Effect.void))
            }
          })

          const add = Effect.fnUntraced(function* () {
            yield* sync()
            const [diff, other] = yield* Effect.all(
              [
                git([...quote, ...args(["diff-files", "--name-only", "-z", "--", "."])], {
                  cwd: state.directory,
                }),
                git(
                  [...quote, ...args(["ls-files", "--full-name", "--others", "--exclude-standard", "-z", "--", "."])],
                  {
                    cwd: state.directory,
                  },
                ),
              ],
              { concurrency: 2 },
            )
            if (diff.code !== 0 || other.code !== 0) {
              yield* Effect.logError("failed to list snapshot files", {
                diffCode: diff.code,
                diffStderr: diff.stderr,
                otherCode: other.code,
                otherStderr: other.stderr,
              })
              return false
            }

            const tracked = diff.text.split("\0").filter(Boolean)
            const untracked = other.text.split("\0").filter(Boolean)
            const all = Array.from(new Set([...tracked, ...untracked]))
            if (!all.length) return true

            // Resolve source-repo ignore rules against the exact candidate set.
            // --no-index keeps this pattern-based even when a path is already tracked.
            const ignored = yield* ignore(all)

            // Remove newly-ignored files from snapshot index to prevent re-adding
            if (ignored.size > 0) {
              const ignoredFiles = Array.from(ignored)
              yield* Effect.logInfo("removing gitignored files from snapshot", { count: ignoredFiles.length })
              if (!(yield* drop(ignoredFiles))) return false
            }

            const allow = all.filter((item) => !ignored.has(item))
            if (!allow.length) return true

            // Only untracked paths can block staging (see `block` below), so the
            // stat sweep never needs to touch tracked files.
            const large = new Set(
              (yield* Effect.all(
                untracked.map((item) =>
                  fs
                    .stat(path.join(state.worktree, item))
                    .pipe(Effect.catch(() => Effect.void))
                    .pipe(
                      Effect.map((stat) => {
                        if (!stat || stat.type !== "File") return
                        const size = typeof stat.size === "bigint" ? Number(stat.size) : stat.size
                        return size > limit ? item : undefined
                      }),
                    ),
                ),
                { concurrency: 8 },
              )).filter((item): item is string => Boolean(item)),
            )
            const block = new Set(untracked.filter((item) => large.has(item)))
            if (block.size) yield* sync(Array.from(block))
            // Stage only the allowed candidate paths so snapshot updates stay scoped.
            return yield* stage(allow.filter((item) => !block.has(item)))
          })

          const setup = Effect.fnUntraced(function* (existed: boolean) {
            if (!existed) {
              const sourceFormatResult = yield* git(["rev-parse", "--show-object-format"], { cwd: state.worktree })
              const sourceFormat = sourceFormatResult.code === 0 ? sourceFormatResult.text.trim() : undefined
              const init = yield* git(["init", ...(sourceFormat ? [`--object-format=${sourceFormat}`] : [])], {
                env: { GIT_DIR: state.gitdir, GIT_WORK_TREE: state.worktree },
              })
              if (init.code !== 0) {
                yield* Effect.logError("failed to initialize snapshot git repository", {
                  exitCode: init.code,
                  stderr: init.stderr,
                })
                return false
              }
              const configuration = [
                ["core.autocrlf", "false"],
                ["core.longpaths", "true"],
                ["core.symlinks", "true"],
                ["core.fsmonitor", "false"],
                ["feature.manyFiles", "true"],
                ["index.version", "4"],
                ["index.threads", "true"],
                ["core.untrackedCache", "true"],
              ]
              for (const [key, value] of configuration) {
                const result = yield* git(["--git-dir", state.gitdir, "config", key, value])
                if (result.code === 0) continue
                yield* Effect.logWarning("failed to configure new snapshot git repository", {
                  key,
                  exitCode: result.code,
                  stderr: result.stderr,
                })
              }

              yield* seed(sourceFormat)
              yield* Effect.logInfo("initialized")
            }
            return true
          })

          const cleanup = Effect.fnUntraced(function* () {
            return yield* lockedLocal(
              Effect.gen(function* () {
                if (!(yield* enabled())) return
                if (!(yield* exists(state.gitdir))) return
                // `--auto` lets git skip the repack when thresholds are not met, so the
                // hourly tick stops holding the per-gitdir semaphore for minutes on idle.
                const result = yield* git(args(["gc", "--auto", `--prune=${prune}`]), { cwd: state.directory })
                if (result.code !== 0) {
                  yield* Effect.logWarning("cleanup failed", {
                    exitCode: result.code,
                    stderr: result.stderr,
                  })
                  return
                }
                yield* Effect.logInfo("cleanup", { prune })
              }),
            ).pipe(
              Effect.sandbox,
              Effect.catch((cause) => Effect.logError("snapshot cleanup failed", { cause: Cause.pretty(cause) })),
            )
          })

          const trackOnce = Effect.fnUntraced(function* (onStart: () => void) {
            return yield* safeLocked(
              "track",
              undefined,
              Effect.gen(function* () {
                onStart()
                if (!(yield* enabled())) return
                const existed = yield* exists(state.gitdir)
                yield* fs.ensureDir(state.gitdir).pipe(Effect.orDie)
                if (!(yield* setup(existed))) return
                return yield* withTransactionToken(
                  Effect.gen(function* () {
                    const capture = Effect.gen(function* () {
                      if (!(yield* add())) return
                      const result = yield* git(args(["write-tree"]), { cwd: state.directory })
                      if (result.code !== 0) {
                        yield* Effect.logError("failed to write snapshot tree", {
                          exitCode: result.code,
                          stderr: result.stderr,
                        })
                        return
                      }
                      const hash = result.text.trim()
                      if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(hash)) {
                        yield* Effect.logError("snapshot git returned an invalid tree hash", {
                          hash,
                          stderr: result.stderr,
                        })
                        return
                      }
                      return hash
                    })

                    // A corrupt index can silently produce the empty tree; rebuild it and recapture once before accepting the result.
                    const hash = yield* capture.pipe(
                      Effect.flatMap((captured) => {
                        if (captured === undefined || !isSnapshotEmptyTree(captured)) return Effect.succeed(captured)
                        return Effect.gen(function* () {
                          yield* Effect.logWarning("snapshot_empty_tree_detected", {
                            hash: captured,
                            gitdir: state.gitdir,
                          })
                          yield* fs.remove(path.join(state.gitdir, "index")).pipe(Effect.ignore)
                          const retry = yield* capture
                          if (retry !== undefined && !isSnapshotEmptyTree(retry)) {
                            yield* Effect.logWarning("snapshot_empty_tree_recovered", {
                              hash: retry,
                              gitdir: state.gitdir,
                            })
                          }
                          return retry
                        })
                      }),
                    )
                    if (hash === undefined) return
                    yield* Effect.logInfo("tracking", { hash, cwd: state.directory, git: state.gitdir })
                    return hash
                  }),
                )
              }),
            )
          })

          // Parallel agents in one worktree call track() at every step boundary, and each
          // capture is a full stage + write-tree pass behind the gitdir lock. Coalesce bursts:
          // callers that arrive before the queued capture takes the lock share its tree (taken
          // after they asked, so it reflects their writes); callers that arrive while a capture
          // runs queue the next one. A burst of N callers costs at most two captures instead of N.
          const trackSlot: { pending?: Deferred.Deferred<{ hash: string | undefined } | undefined> } = {}
          const track = Effect.fnUntraced(function* () {
            const pending = trackSlot.pending
            if (pending) {
              const joined = yield* Deferred.await(pending)
              // An interrupted leader resolves undefined; capture independently in that case.
              if (joined) return joined.hash
              return yield* trackOnce(() => {})
            }
            const next = Deferred.makeUnsafe<{ hash: string | undefined } | undefined>()
            trackSlot.pending = next
            const release = () => {
              if (trackSlot.pending === next) trackSlot.pending = undefined
            }
            return yield* trackOnce(release).pipe(
              Effect.tap((hash) => Deferred.succeed(next, { hash })),
              Effect.ensuring(
                Effect.suspend(() => {
                  release()
                  return Deferred.succeed(next, undefined)
                }),
              ),
            )
          })

          const patch = Effect.fnUntraced(function* (hash: string, options?: { to?: string }) {
            return yield* safeLocked(
              "patch",
              { hash, files: [] },
              Effect.gen(function* () {
                if (!(yield* enabled())) return { hash, files: [] }
                // The empty Patch shape is intentional; staging loss has a stable operator diagnostic.
                if (!options?.to && !(yield* add())) {
                  yield* Effect.logError("snapshot_patch_stage_failed", { hash })
                  return { hash, files: [] }
                }
                const result = yield* git(
                  options?.to
                    ? [...quote, ...args(["diff", "--no-ext-diff", "--name-only", hash, options.to, "--", "."])]
                    : [...quote, ...args(["diff", "--cached", "--no-ext-diff", "--name-only", hash, "--", "."])],
                  {
                    cwd: state.directory,
                  },
                )
                if (result.code !== 0) {
                  yield* Effect.logWarning("failed to get diff", { hash, exitCode: result.code })
                  return { hash, files: [] }
                }
                const files = result.text
                  .trim()
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean)

                // Hide ignored-file removals from the user-facing patch output.
                const ignored = yield* ignore(files)

                return {
                  hash,
                  files: files
                    .filter((item) => !ignored.has(item))
                    .map((x) => path.join(state.worktree, x).replaceAll("\\", "/")),
                }
              }),
            )
          })

          const restore = Effect.fnUntraced(function* (snapshot: string) {
            return yield* safeLocked(
              "restore",
              false,
              Effect.gen(function* () {
                if (!(yield* enabled())) return false
                yield* Effect.logInfo("restore", { commit: snapshot })
                const result = yield* git([...core, ...args(["read-tree", snapshot])], { cwd: state.worktree })
                if (result.code === 0) {
                  const checkout = yield* git([...core, ...args(["checkout-index", "-a", "-f"])], {
                    cwd: state.worktree,
                  })
                  if (checkout.code === 0) return true
                  yield* Effect.logError("failed to restore snapshot", {
                    snapshot,
                    exitCode: checkout.code,
                    stderr: checkout.stderr,
                  })
                  return false
                }
                yield* Effect.logError("failed to restore snapshot", {
                  snapshot,
                  exitCode: result.code,
                  stderr: result.stderr,
                })
                return false
              }),
            )
          })

          const revert = Effect.fnUntraced(function* (patches: Patch[]) {
            return yield* safeLocked(
              "revert",
              false,
              Effect.gen(function* () {
                if (!(yield* enabled())) return false
                // File restoration spans checkout and deletion; git does not provide a single atomic operation for this sequence.
                const ops: { hash: string; file: string; rel: string }[] = []
                const seen = new Set<string>()
                for (const item of patches) {
                  for (const file of item.files) {
                    if (seen.has(file)) continue
                    seen.add(file)
                    ops.push({
                      hash: item.hash,
                      file,
                      rel: path.relative(state.worktree, file).replaceAll("\\", "/"),
                    })
                  }
                }

                const single = Effect.fnUntraced(function* (op: (typeof ops)[number]) {
                  yield* Effect.logInfo("reverting", { file: op.file, hash: op.hash })
                  const result = yield* git([...core, ...args(["checkout", op.hash, "--", op.file])], {
                    cwd: state.worktree,
                  })
                  if (result.code === 0) return true
                  const tree = yield* git([...core, ...args(["ls-tree", op.hash, "--", op.rel])], {
                    cwd: state.worktree,
                  })
                  if (tree.code === 0 && tree.text.trim()) {
                    yield* Effect.logInfo("file existed in snapshot but checkout failed, keeping", {
                      file: op.file,
                      hash: op.hash,
                    })
                    return true
                  }
                  yield* Effect.logInfo("file did not exist in snapshot, deleting", { file: op.file, hash: op.hash })
                  yield* remove(op.file)
                  return true
                })

                const clash = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)

                for (let i = 0; i < ops.length; ) {
                  yield* Effect.yieldNow
                  const first = ops[i]!
                  const run = [first]
                  let j = i + 1
                  // Only batch adjacent files when their paths cannot affect each other.
                  while (j < ops.length && run.length < 100) {
                    const next = ops[j]!
                    if (next.hash !== first.hash) break
                    if (run.some((item) => clash(item.rel, next.rel))) break
                    run.push(next)
                    j += 1
                  }

                  if (run.length === 1) {
                    yield* single(first)
                    i = j
                    continue
                  }

                  const tree = yield* git(
                    [...core, ...args(["ls-tree", "--name-only", first.hash, "--", ...run.map((item) => item.rel)])],
                    {
                      cwd: state.worktree,
                    },
                  )

                  if (tree.code !== 0) {
                    yield* Effect.logInfo("batched ls-tree failed, falling back to single-file revert", {
                      hash: first.hash,
                      files: run.length,
                    })
                    for (const op of run) {
                      yield* single(op)
                    }
                    i = j
                    continue
                  }

                  const have = new Set(
                    tree.text
                      .trim()
                      .split("\n")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  )
                  const list = run.filter((item) => have.has(item.rel))
                  if (list.length) {
                    yield* Effect.logInfo("reverting", { hash: first.hash, files: list.length })
                    const result = yield* git(
                      [...core, ...args(["checkout", first.hash, "--", ...list.map((item) => item.file)])],
                      {
                        cwd: state.worktree,
                      },
                    )
                    if (result.code !== 0) {
                      yield* Effect.logInfo("batched checkout failed, falling back to single-file revert", {
                        hash: first.hash,
                        files: list.length,
                      })
                      for (const op of run) {
                        yield* single(op)
                      }
                      i = j
                      continue
                    }
                  }

                  for (const op of run) {
                    if (have.has(op.rel)) continue
                    yield* Effect.logInfo("file did not exist in snapshot, deleting", { file: op.file, hash: op.hash })
                    yield* remove(op.file)
                  }

                  i = j
                }
                return true
              }),
            )
          })

          const diff = Effect.fnUntraced(function* (hash: string) {
            return yield* safeLocked(
              "diff",
              "",
              Effect.gen(function* () {
                if (!(yield* enabled())) return ""
                // The empty diff shape is intentional; staging failure is separately observable for operators.
                if (!(yield* add())) {
                  yield* Effect.logError("snapshot_diff_stage_failed", { hash })
                  return ""
                }
                const result = yield* git([...quote, ...args(["diff", "--cached", "--no-ext-diff", hash, "--", "."])], {
                  cwd: state.worktree,
                })
                if (result.code !== 0) {
                  yield* Effect.logWarning("failed to get diff", {
                    hash,
                    exitCode: result.code,
                    stderr: result.stderr,
                  })
                  return ""
                }
                return result.text.trim()
              }),
            )
          })

          // Failure and disabled state return undefined so callers never publish an
          // empty diff over a stored one.
          const diffFull = Effect.fnUntraced(function* (
            from: string,
            to: string,
            previous?: { to: string; diffs: FileDiff[] },
          ) {
            return yield* safeRead(
              "diffFull",
              undefined,
              Effect.gen(function* () {
                if (!(yield* enabled())) return undefined
                type Row = {
                  file: string
                  status: "added" | "deleted" | "modified"
                  binary: boolean
                  additions: number
                  deletions: number
                  carry?: FileDiff
                }

                type Ref = {
                  file: string
                  side: "before" | "after"
                  ref: string
                }

                const show = Effect.fnUntraced(function* (row: Row) {
                  if (row.binary) return ["", ""]
                  if (row.status === "added") {
                    return [
                      "",
                      yield* git([...cfg, ...args(["show", `${to}:${row.file}`])]).pipe(
                        Effect.map((item) => item.text),
                      ),
                    ]
                  }
                  if (row.status === "deleted") {
                    return [
                      yield* git([...cfg, ...args(["show", `${from}:${row.file}`])]).pipe(
                        Effect.map((item) => item.text),
                      ),
                      "",
                    ]
                  }
                  return yield* Effect.all(
                    [
                      git([...cfg, ...args(["show", `${from}:${row.file}`])]).pipe(Effect.map((item) => item.text)),
                      git([...cfg, ...args(["show", `${to}:${row.file}`])]).pipe(Effect.map((item) => item.text)),
                    ],
                    { concurrency: 2 },
                  )
                })

                const load = Effect.fnUntraced(
                  function* (rows: Row[]) {
                    const refs = rows.flatMap((row) => {
                      if (row.binary || row.carry) return []
                      if (row.status === "added")
                        return [{ file: row.file, side: "after", ref: `${to}:${row.file}` } satisfies Ref]
                      if (row.status === "deleted") {
                        return [{ file: row.file, side: "before", ref: `${from}:${row.file}` } satisfies Ref]
                      }
                      return [
                        { file: row.file, side: "before", ref: `${from}:${row.file}` } satisfies Ref,
                        { file: row.file, side: "after", ref: `${to}:${row.file}` } satisfies Ref,
                      ]
                    })
                    if (!refs.length) return new Map<string, { before: string; after: string }>()

                    const batch = yield* appProcess.run(
                      ChildProcess.make("git", [...cfg, ...args(["cat-file", "--batch"])], {
                        cwd: state.directory,
                        env: snapshotGitEnv(),
                        extendEnv: true,
                      }),
                      { stdin: refs.map((item) => item.ref).join("\n") + "\n" },
                    )
                    if (batch.exitCode !== 0) {
                      yield* Effect.logInfo(
                        "git cat-file --batch failed during snapshot diff, falling back to per-file git show",
                        {
                          stderr: batch.stderr.toString("utf8"),
                          refs: refs.length,
                        },
                      )
                      return
                    }
                    const out = batch.stdout

                    const fail = (message: string, extra?: Record<string, string>) =>
                      Effect.logInfo(message, extra).pipe(Effect.as(undefined))

                    const map = new Map<string, { before: string; after: string }>()
                    const dec = new TextDecoder()
                    let i = 0
                    for (const ref of refs) {
                      let end = i
                      while (end < out.length && out[end] !== 10) end += 1
                      if (end >= out.length) {
                        return yield* fail(
                          "git cat-file --batch returned a truncated header during snapshot diff, falling back to per-file git show",
                        )
                      }

                      const head = dec.decode(out.subarray(i, end))
                      i = end + 1
                      const hit = map.get(ref.file) ?? { before: "", after: "" }
                      if (head.endsWith(" missing")) {
                        map.set(ref.file, hit)
                        continue
                      }

                      const match = head.match(/^[0-9a-f]+ blob (\d+)$/)
                      if (!match) {
                        return yield* fail(
                          "git cat-file --batch returned an unexpected header during snapshot diff, falling back to per-file git show",
                          { head },
                        )
                      }

                      const size = Number(match[1])
                      if (!Number.isInteger(size) || size < 0 || i + size >= out.length || out[i + size] !== 10) {
                        return yield* fail(
                          "git cat-file --batch returned truncated content during snapshot diff, falling back to per-file git show",
                          { head },
                        )
                      }

                      const text = dec.decode(out.subarray(i, i + size))
                      if (ref.side === "before") hit.before = text
                      if (ref.side === "after") hit.after = text
                      map.set(ref.file, hit)
                      i += size + 1
                    }

                    if (i !== out.length) {
                      return yield* fail(
                        "git cat-file --batch returned trailing data during snapshot diff, falling back to per-file git show",
                      )
                    }

                    return map
                  },
                  Effect.scoped,
                  Effect.catch(() =>
                    Effect.succeed<Map<string, { before: string; after: string }> | undefined>(undefined),
                  ),
                )

                const result: FileDiff[] = []
                const status = new Map<string, "added" | "deleted" | "modified">()
                const ordered: string[] = []

                const statuses = yield* git(
                  [...quote, ...args(["diff", "--no-ext-diff", "--name-status", "--no-renames", from, to, "--", "."])],
                  { cwd: state.directory },
                )

                for (const line of statuses.text.trim().split("\n")) {
                  if (!line) continue
                  const [code, file] = line.split("\t")
                  if (!code || !file) continue
                  ordered.push(file)
                  status.set(file, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified")
                }

                // Incremental reuse: a file not modified since the previous baseline still
                // diffs identically (from -> previous.to) == (from -> to), so its row and
                // patch are carried instead of re-reading whole-turn content every step.
                const carried = new Map<string, FileDiff>()
                if (previous) {
                  for (const entry of previous.diffs) {
                    if (entry.file && !entry.truncated && entry.patch) carried.set(entry.file, entry)
                  }
                  if (previous.to !== to && carried.size) {
                    const delta = yield* git(
                      [
                        ...quote,
                        ...args(["diff", "--no-ext-diff", "--no-renames", "--name-status", previous.to, to, "--", "."]),
                      ],
                      { cwd: state.directory },
                    )
                    if (delta.code === 0) {
                      for (const line of delta.text.trim().split("\n")) {
                        const [, file] = line.split("\t")
                        if (file) carried.delete(file)
                      }
                    } else {
                      carried.clear()
                    }
                  }
                }

                // numstat is a content diff, so compute it only for rows that are not carried.
                const needNumstat = ordered.filter((file) => !carried.has(file))
                const counts = new Map<string, { binary: boolean; additions: number; deletions: number }>()
                const numstat = Effect.fnUntraced(function* (paths: string[] | undefined) {
                  const chunk = 200
                  const runs = paths
                    ? Array.from({ length: Math.ceil(paths.length / chunk) }, (_, i) =>
                        paths.slice(i * chunk, (i + 1) * chunk),
                      )
                    : [undefined]
                  for (const run of runs) {
                    const command = yield* git(
                      [
                        ...quote,
                        ...args(["diff", "--no-ext-diff", "--no-renames", "--numstat", from, to]),
                        ...(run ? ["--", ...run.map((file) => `:(top,literal)${file}`)] : ["--", "."]),
                      ],
                      { cwd: state.directory },
                    )
                    for (const line of command.text.trim().split("\n")) {
                      const [adds, dels, file] = line.split("\t")
                      if (!file) continue
                      const binary = adds === "-" && dels === "-"
                      const additions = binary ? 0 : parseInt(adds)
                      const deletions = binary ? 0 : parseInt(dels)
                      counts.set(file, {
                        binary,
                        additions: Number.isFinite(additions) ? additions : 0,
                        deletions: Number.isFinite(deletions) ? deletions : 0,
                      })
                    }
                  }
                })
                if (needNumstat.length) yield* numstat(previous ? needNumstat : undefined)

                const rows: Row[] = ordered.flatMap((file) => {
                  const carry = carried.get(file)
                  if (carry) {
                    return [
                      {
                        file,
                        status: status.get(file) ?? "modified",
                        binary: false,
                        additions: carry.additions,
                        deletions: carry.deletions,
                        carry,
                      } satisfies Row,
                    ]
                  }
                  const count = counts.get(file)
                  if (!count) return []
                  return [
                    {
                      file,
                      status: status.get(file) ?? "modified",
                      binary: count.binary,
                      additions: count.additions,
                      deletions: count.deletions,
                    } satisfies Row,
                  ]
                })

                // Hide ignored-file removals from the user-facing diff output.
                const ignored = yield* ignore(rows.map((r) => r.file))
                const visible = ignored.size > 0 ? rows.filter((r) => !ignored.has(r.file)) : rows

                const step = 100
                const patch = (file: string, before: string, after: string) =>
                  formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))
                // Patch text is display-only: revert works from tree hashes, never from this text.
                // Telemetry and log blobs would otherwise embed whole files into every diff event
                // and row, so withhold patch text beyond a per-file and total budget.
                const PATCH_FILE_BUDGET = 1024 * 1024
                const PATCH_TOTAL_BUDGET = 1024 * 1024
                let patchBudget = PATCH_TOTAL_BUDGET

                for (let i = 0; i < visible.length; i += step) {
                  const run = visible.slice(i, i + step)
                  yield* Effect.yieldNow
                  const text = yield* load(run)

                  for (const row of run) {
                    if (row.carry) {
                      const oversize = !row.binary && patchBudget <= 0
                      const patchText = oversize ? "" : row.carry.patch!
                      if (!oversize && !row.binary) patchBudget -= patchText.length
                      result.push({
                        file: row.file,
                        patch: patchText,
                        additions: row.additions,
                        deletions: row.deletions,
                        status: row.status,
                        ...(oversize ? { truncated: true as const } : {}),
                      })
                      continue
                    }
                    const hit = text?.get(row.file) ?? { before: "", after: "" }
                    const [before, after] = row.binary ? ["", ""] : text ? [hit.before, hit.after] : yield* show(row)
                    const oversize =
                      !row.binary && (before.length + after.length > PATCH_FILE_BUDGET || patchBudget <= 0)
                    const patchText = row.binary || oversize ? "" : patch(row.file, before, after)
                    if (!oversize && !row.binary) patchBudget -= patchText.length
                    result.push({
                      file: row.file,
                      patch: patchText,
                      additions: row.additions,
                      deletions: row.deletions,
                      status: row.status,
                      ...(oversize ? { truncated: true as const } : {}),
                    })
                  }
                }

                return result
              }),
            )
          })

          yield* cleanup().pipe(
            Effect.catchCause((cause) => Effect.logError("cleanup loop failed", { cause: Cause.pretty(cause) })),
            Effect.repeat(Schedule.spaced(Duration.hours(1))),
            Effect.delay(Duration.minutes(1)),
            Effect.forkScoped,
          )

          return { cleanup, track, patch, restore, revert, diff, diffFull }
        }),
      )

      return Service.of({
        init: Effect.fn("Snapshot.init")(function* () {
          yield* InstanceState.get(state)
        }),
        cleanup: Effect.fn("Snapshot.cleanup")(function* () {
          return yield* InstanceState.useEffect(state, (s) => s.cleanup())
        }),
        track: Effect.fn("Snapshot.track")(function* () {
          return yield* InstanceState.useEffect(state, (s) => s.track())
        }),
        patch: Effect.fn("Snapshot.patch")(function* (hash: string, options?: { to?: string }) {
          return yield* InstanceState.useEffect(state, (s) => s.patch(hash, options))
        }),
        restore: Effect.fn("Snapshot.restore")(function* (snapshot: string) {
          return yield* InstanceState.useEffect(state, (s) => s.restore(snapshot))
        }),
        revert: Effect.fn("Snapshot.revert")(function* (patches: Patch[]) {
          return yield* InstanceState.useEffect(state, (s) => s.revert(patches))
        }),
        diff: Effect.fn("Snapshot.diff")(function* (hash: string) {
          return yield* InstanceState.useEffect(state, (s) => s.diff(hash))
        }),
        diffFull: Effect.fn("Snapshot.diffFull")(function* (
          from: string,
          to: string,
          previous?: { to: string; diffs: FileDiff[] },
        ) {
          return yield* InstanceState.useEffect(state, (s) => s.diffFull(from, to, previous))
        }),
      })
    }),
  )

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [FSUtil.node, AppProcess.node, Config.node, EffectFlock.node],
})

export * as Snapshot from "."
