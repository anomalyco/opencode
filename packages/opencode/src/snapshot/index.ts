import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Cause, Duration, Effect, Layer, Schedule, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import z from "zod"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { InstanceState } from "@/effect/instance-state"
import { makeRunPromise } from "@/effect/run-service"
import { AppFileSystem } from "@/filesystem"
import { Config } from "../config/config"
import { Global } from "../global"
import { Log } from "../util/log"

export namespace Snapshot {
  export const Patch = z.object({
    hash: z.string(),
    files: z.string().array(),
  })
  export type Patch = z.infer<typeof Patch>

  export const FileDiff = z
    .object({
      file: z.string(),
      before: z.string(),
      after: z.string(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "FileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>

  const log = Log.create({ service: "snapshot" })
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

  type State = Omit<Interface, "init">

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly cleanup: () => Effect.Effect<void>
    readonly track: () => Effect.Effect<string | undefined>
    readonly patch: (hash: string) => Effect.Effect<Snapshot.Patch>
    readonly restore: (snapshot: string) => Effect.Effect<void>
    readonly revert: (patches: Snapshot.Patch[]) => Effect.Effect<void>
    readonly diff: (hash: string) => Effect.Effect<string>
    readonly diffFull: (from: string, to: string) => Effect.Effect<Snapshot.FileDiff[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Snapshot") {}

  export const layer: Layer.Layer<Service, never, AppFileSystem.Service | ChildProcessSpawner.ChildProcessSpawner> =
    Layer.effect(
      Service,
      Effect.gen(function* () {
        const fs = yield* AppFileSystem.Service
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const state = yield* InstanceState.make<State>(
          Effect.fn("Snapshot.state")(function* (ctx) {
            const state = {
              directory: ctx.directory,
              worktree: ctx.worktree,
              gitdir: path.join(Global.Path.data, "snapshot", ctx.project.id),
              vcs: ctx.project.vcs,
            }

            const args = (cmd: string[]) => ["--git-dir", state.gitdir, "--work-tree", state.worktree, ...cmd]

            const git = Effect.fnUntraced(
              function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
                const proc = ChildProcess.make("git", cmd, {
                  cwd: opts?.cwd,
                  env: opts?.env,
                  extendEnv: true,
                })
                const handle = yield* spawner.spawn(proc)
                const [text, stderr] = yield* Effect.all(
                  [
                    Stream.mkString(Stream.decodeText(handle.stdout)),
                    Stream.mkString(Stream.decodeText(handle.stderr)),
                  ],
                  { concurrency: 2 },
                )
                const code = yield* handle.exitCode
                return { code, text, stderr } satisfies GitResult
              },
              Effect.scoped,
              Effect.catch((err) =>
                Effect.succeed({
                  code: ChildProcessSpawner.ExitCode(1),
                  text: "",
                  stderr: String(err),
                }),
              ),
            )

            const exists = (file: string) => fs.exists(file).pipe(Effect.orDie)
            const read = (file: string) => fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed("")))
            const remove = (file: string) => fs.remove(file).pipe(Effect.catch(() => Effect.void))

            const enabled = Effect.fnUntraced(function* () {
              if (state.vcs !== "git") return false
              return (yield* Effect.promise(() => Config.get())).snapshot !== false
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

            const add = Effect.fnUntraced(function* () {
              yield* sync()
              const [diff, other] = yield* Effect.all(
                [
                  git([...quote, ...args(["diff-files", "--name-only", "-z", "--", "."])], {
                    cwd: state.directory,
                  }),
                  git([...quote, ...args(["ls-files", "--others", "--exclude-standard", "-z", "--", "."])], {
                    cwd: state.directory,
                  }),
                ],
                { concurrency: 2 },
              )
              if (diff.code !== 0 || other.code !== 0) {
                log.warn("failed to list snapshot files", {
                  diffCode: diff.code,
                  diffStderr: diff.stderr,
                  otherCode: other.code,
                  otherStderr: other.stderr,
                })
                return
              }

              const tracked = diff.text.split("\0").filter(Boolean)
              const all = Array.from(new Set([...tracked, ...other.text.split("\0").filter(Boolean)]))
              if (!all.length) return

              const large = (yield* Effect.all(
                all.map((item) =>
                  fs
                    .stat(path.join(state.directory, item))
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
              )).filter((item): item is string => Boolean(item))
              yield* sync(large)
              const result = yield* git([...cfg, ...args(["add", "--sparse", "."])], { cwd: state.directory })
              if (result.code !== 0) {
                log.warn("failed to add snapshot files", {
                  exitCode: result.code,
                  stderr: result.stderr,
                })
              }
            })

            const cleanup = Effect.fnUntraced(function* () {
              if (!(yield* enabled())) return
              if (!(yield* exists(state.gitdir))) return
              const result = yield* git(args(["gc", `--prune=${prune}`]), { cwd: state.directory })
              if (result.code !== 0) {
                log.warn("cleanup failed", {
                  exitCode: result.code,
                  stderr: result.stderr,
                })
                return
              }
              log.info("cleanup", { prune })
            })

            const track = Effect.fnUntraced(function* () {
              if (!(yield* enabled())) return
              const existed = yield* exists(state.gitdir)
              yield* fs.ensureDir(state.gitdir).pipe(Effect.orDie)
              if (!existed) {
                yield* git(["init"], {
                  env: { GIT_DIR: state.gitdir, GIT_WORK_TREE: state.worktree },
                })
                yield* git(["--git-dir", state.gitdir, "config", "core.autocrlf", "false"])
                yield* git(["--git-dir", state.gitdir, "config", "core.longpaths", "true"])
                yield* git(["--git-dir", state.gitdir, "config", "core.symlinks", "true"])
                yield* git(["--git-dir", state.gitdir, "config", "core.fsmonitor", "false"])
                log.info("initialized")
              }
              yield* add()
              const result = yield* git(args(["write-tree"]), { cwd: state.directory })
              const hash = result.text.trim()
              log.info("tracking", { hash, cwd: state.directory, git: state.gitdir })
              return hash
            })

            const patch = Effect.fnUntraced(function* (hash: string) {
              yield* add()
              const result = yield* git(
                [...quote, ...args(["diff", "--cached", "--no-ext-diff", "--name-only", hash, "--", "."])],
                {
                  cwd: state.directory,
                },
              )
              if (result.code !== 0) {
                log.warn("failed to get diff", { hash, exitCode: result.code })
                return { hash, files: [] }
              }
              return {
                hash,
                files: result.text
                  .trim()
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean)
                  .map((x) => path.join(state.worktree, x).replaceAll("\\", "/")),
              }
            })

            const restore = Effect.fnUntraced(function* (snapshot: string) {
              log.info("restore", { commit: snapshot })
              const result = yield* git([...core, ...args(["read-tree", snapshot])], { cwd: state.worktree })
              if (result.code === 0) {
                const checkout = yield* git([...core, ...args(["checkout-index", "-a", "-f"])], { cwd: state.worktree })
                if (checkout.code === 0) return
                log.error("failed to restore snapshot", {
                  snapshot,
                  exitCode: checkout.code,
                  stderr: checkout.stderr,
                })
                return
              }
              log.error("failed to restore snapshot", {
                snapshot,
                exitCode: result.code,
                stderr: result.stderr,
              })
            })

            const revert = Effect.fnUntraced(function* (patches: Snapshot.Patch[]) {
              const seen = new Set<string>()
              for (const item of patches) {
                for (const file of item.files) {
                  if (seen.has(file)) continue
                  seen.add(file)
                  log.info("reverting", { file, hash: item.hash })
                  const result = yield* git([...core, ...args(["checkout", item.hash, "--", file])], {
                    cwd: state.worktree,
                  })
                  if (result.code !== 0) {
                    const rel = path.relative(state.worktree, file)
                    const tree = yield* git([...core, ...args(["ls-tree", item.hash, "--", rel])], {
                      cwd: state.worktree,
                    })
                    if (tree.code === 0 && tree.text.trim()) {
                      log.info("file existed in snapshot but checkout failed, keeping", { file })
                    } else {
                      log.info("file did not exist in snapshot, deleting", { file })
                      yield* remove(file)
                    }
                  }
                }
              }
            })

            const diff = Effect.fnUntraced(function* (hash: string) {
              yield* add()
              const result = yield* git([...quote, ...args(["diff", "--cached", "--no-ext-diff", hash, "--", "."])], {
                cwd: state.worktree,
              })
              if (result.code !== 0) {
                log.warn("failed to get diff", {
                  hash,
                  exitCode: result.code,
                  stderr: result.stderr,
                })
                return ""
              }
              return result.text.trim()
            })

            const diffFull = Effect.fnUntraced(function* (from: string, to: string) {
              const result: Snapshot.FileDiff[] = []
              const status = new Map<string, "added" | "deleted" | "modified">()

              const statuses = yield* git(
                [...quote, ...args(["diff", "--no-ext-diff", "--name-status", "--no-renames", from, to, "--", "."])],
                { cwd: state.directory },
              )

              for (const line of statuses.text.trim().split("\n")) {
                if (!line) continue
                const [code, file] = line.split("\t")
                if (!code || !file) continue
                status.set(file, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified")
              }

              const numstat = yield* git(
                [...quote, ...args(["diff", "--no-ext-diff", "--no-renames", "--numstat", from, to, "--", "."])],
                {
                  cwd: state.directory,
                },
              )

              for (const line of numstat.text.trim().split("\n")) {
                if (!line) continue
                const [adds, dels, file] = line.split("\t")
                if (!file) continue
                const binary = adds === "-" && dels === "-"
                const [before, after] = binary
                  ? ["", ""]
                  : yield* Effect.all(
                      [
                        git([...cfg, ...args(["show", `${from}:${file}`])]).pipe(Effect.map((item) => item.text)),
                        git([...cfg, ...args(["show", `${to}:${file}`])]).pipe(Effect.map((item) => item.text)),
                      ],
                      { concurrency: 2 },
                    )
                const additions = binary ? 0 : parseInt(adds)
                const deletions = binary ? 0 : parseInt(dels)
                result.push({
                  file,
                  before,
                  after,
                  additions: Number.isFinite(additions) ? additions : 0,
                  deletions: Number.isFinite(deletions) ? deletions : 0,
                  status: status.get(file) ?? "modified",
                })
              }

              return result
            })

            yield* cleanup().pipe(
              Effect.catchCause((cause) => {
                log.error("cleanup loop failed", { cause: Cause.pretty(cause) })
                return Effect.void
              }),
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
          patch: Effect.fn("Snapshot.patch")(function* (hash: string) {
            return yield* InstanceState.useEffect(state, (s) => s.patch(hash))
          }),
          restore: Effect.fn("Snapshot.restore")(function* (snapshot: string) {
            return yield* InstanceState.useEffect(state, (s) => s.restore(snapshot))
          }),
          revert: Effect.fn("Snapshot.revert")(function* (patches: Snapshot.Patch[]) {
            return yield* InstanceState.useEffect(state, (s) => s.revert(patches))
          }),
          diff: Effect.fn("Snapshot.diff")(function* (hash: string) {
            return yield* InstanceState.useEffect(state, (s) => s.diff(hash))
          }),
          diffFull: Effect.fn("Snapshot.diffFull")(function* (from: string, to: string) {
            return yield* InstanceState.useEffect(state, (s) => s.diffFull(from, to))
          }),
        })
      }),
    )

  export const defaultLayer = layer.pipe(
    Layer.provide(CrossSpawnSpawner.layer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(NodeFileSystem.layer), // needed by CrossSpawnSpawner
    Layer.provide(NodePath.layer),
  )

  const runPromise = makeRunPromise(Service, defaultLayer)

  export async function init() {
    return runPromise((svc) => svc.init())
  }

  export async function cleanup() {
    return runPromise((svc) => svc.cleanup())
  }

  export async function track() {
    return runPromise((svc) => svc.track())
  }

  export async function patch(hash: string) {
    return runPromise((svc) => svc.patch(hash))
  }

  export async function restore(snapshot: string) {
    return runPromise((svc) => svc.restore(snapshot))
  }

  export async function revert(patches: Patch[]) {
    return runPromise((svc) => svc.revert(patches))
  }

  export async function diff(hash: string) {
    return runPromise((svc) => svc.diff(hash))
  }

  export async function diffFull(from: string, to: string) {
    return runPromise((svc) => svc.diffFull(from, to))
  }
}
