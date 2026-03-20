import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node"
import { Cause, Duration, Effect, Layer, Schedule, ServiceMap, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import z from "zod"
import { InstanceContext } from "@/effect/instance-context"
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
  const core = ["-c", "core.longpaths=true", "-c", "core.symlinks=true"]
  const cfg = ["-c", "core.autocrlf=false", ...core]
  const quote = [...cfg, "-c", "core.quotepath=false"]

  interface GitResult {
    readonly code: ChildProcessSpawner.ExitCode
    readonly text: string
    readonly stderr: string
  }

  export interface Interface {
    readonly cleanup: () => Effect.Effect<void>
    readonly track: () => Effect.Effect<string | undefined>
    readonly patch: (hash: string) => Effect.Effect<Snapshot.Patch>
    readonly restore: (snapshot: string) => Effect.Effect<void>
    readonly revert: (patches: Snapshot.Patch[]) => Effect.Effect<void>
    readonly diff: (hash: string) => Effect.Effect<string>
    readonly diffFull: (from: string, to: string) => Effect.Effect<Snapshot.FileDiff[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Snapshot") {}

  export const layer: Layer.Layer<
    Service,
    never,
    InstanceContext | AppFileSystem.Service | ChildProcessSpawner.ChildProcessSpawner
  > = Layer.effect(
    Service,
    Effect.gen(function* () {
      const ctx = yield* InstanceContext
      const fs = yield* AppFileSystem.Service
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const directory = ctx.directory
      const worktree = ctx.worktree
      const project = ctx.project
      const gitdir = path.join(Global.Path.data, "snapshot", project.id)

      const args = (cmd: string[]) => ["--git-dir", gitdir, "--work-tree", worktree, ...cmd]

      const git = Effect.fnUntraced(
        function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
          const proc = ChildProcess.make("git", cmd, {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const [text, stderr] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
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

      // Snapshot-specific error handling on top of AppFileSystem
      const exists = (file: string) => fs.exists(file).pipe(Effect.orDie)
      const read = (file: string) => fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed("")))
      const remove = (file: string) => fs.remove(file).pipe(Effect.catch(() => Effect.void))

      const enabled = Effect.fnUntraced(function* () {
        if (project.vcs !== "git") return false
        return (yield* Effect.promise(() => Config.get())).snapshot !== false
      })

      const excludes = Effect.fnUntraced(function* () {
        const result = yield* git(["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], {
          cwd: worktree,
        })
        const file = result.text.trim()
        if (!file) return
        if (!(yield* exists(file))) return
        return file
      })

      const sync = Effect.fnUntraced(function* () {
        const file = yield* excludes()
        const target = path.join(gitdir, "info", "exclude")
        yield* fs.ensureDir(path.join(gitdir, "info")).pipe(Effect.orDie)
        if (!file) {
          yield* fs.writeFileString(target, "").pipe(Effect.orDie)
          return
        }
        yield* fs.writeFileString(target, yield* read(file)).pipe(Effect.orDie)
      })

      const add = Effect.fnUntraced(function* () {
        yield* sync()
        yield* git([...cfg, ...args(["add", "."])], { cwd: directory })
      })

      const cleanup = Effect.fn("Snapshot.cleanup")(function* () {
        if (!(yield* enabled())) return
        if (!(yield* exists(gitdir))) return
        const result = yield* git(args(["gc", `--prune=${prune}`]), { cwd: directory })
        if (result.code !== 0) {
          log.warn("cleanup failed", {
            exitCode: result.code,
            stderr: result.stderr,
          })
          return
        }
        log.info("cleanup", { prune })
      })

      const track = Effect.fn("Snapshot.track")(function* () {
        if (!(yield* enabled())) return
        const existed = yield* exists(gitdir)
        yield* fs.ensureDir(gitdir).pipe(Effect.orDie)
        if (!existed) {
          yield* git(["init"], {
            env: { GIT_DIR: gitdir, GIT_WORK_TREE: worktree },
          })
          yield* git(["--git-dir", gitdir, "config", "core.autocrlf", "false"])
          yield* git(["--git-dir", gitdir, "config", "core.longpaths", "true"])
          yield* git(["--git-dir", gitdir, "config", "core.symlinks", "true"])
          yield* git(["--git-dir", gitdir, "config", "core.fsmonitor", "false"])
          log.info("initialized")
        }
        yield* add()
        const result = yield* git(args(["write-tree"]), { cwd: directory })
        const hash = result.text.trim()
        log.info("tracking", { hash, cwd: directory, git: gitdir })
        return hash
      })

      const patch = Effect.fn("Snapshot.patch")(function* (hash: string) {
        yield* add()
        const result = yield* git([...quote, ...args(["diff", "--no-ext-diff", "--name-only", hash, "--", "."])], {
          cwd: directory,
        })
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
            .map((x) => path.join(worktree, x).replaceAll("\\", "/")),
        }
      })

      const restore = Effect.fn("Snapshot.restore")(function* (snapshot: string) {
        log.info("restore", { commit: snapshot })
        const result = yield* git([...core, ...args(["read-tree", snapshot])], { cwd: worktree })
        if (result.code === 0) {
          const checkout = yield* git([...core, ...args(["checkout-index", "-a", "-f"])], { cwd: worktree })
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

      const revert = Effect.fn("Snapshot.revert")(function* (patches: Snapshot.Patch[]) {
        const seen = new Set<string>()
        for (const item of patches) {
          for (const file of item.files) {
            if (seen.has(file)) continue
            seen.add(file)
            log.info("reverting", { file, hash: item.hash })
            const result = yield* git([...core, ...args(["checkout", item.hash, "--", file])], { cwd: worktree })
            if (result.code !== 0) {
              const rel = path.relative(worktree, file)
              const tree = yield* git([...core, ...args(["ls-tree", item.hash, "--", rel])], { cwd: worktree })
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

      const diff = Effect.fn("Snapshot.diff")(function* (hash: string) {
        yield* add()
        const result = yield* git([...quote, ...args(["diff", "--no-ext-diff", hash, "--", "."])], {
          cwd: worktree,
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

      const diffFull = Effect.fn("Snapshot.diffFull")(function* (from: string, to: string) {
        const result: Snapshot.FileDiff[] = []
        const status = new Map<string, "added" | "deleted" | "modified">()

        const statuses = yield* git(
          [...quote, ...args(["diff", "--no-ext-diff", "--name-status", "--no-renames", from, to, "--", "."])],
          { cwd: directory },
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
            cwd: directory,
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

      return Service.of({ cleanup, track, patch, restore, revert, diff, diffFull })
    }),
  ).pipe(Layer.fresh)

  export const defaultLayer = layer.pipe(
    Layer.provide(NodeChildProcessSpawner.layer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(NodeFileSystem.layer), // needed by NodeChildProcessSpawner
    Layer.provide(NodePath.layer),
  )
}
