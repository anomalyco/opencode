import { Cause, Effect, Fiber, Queue, Scope, Sink, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import path from "node:path"
// @ts-ignore — @parcel/watcher's main entry requires a precompiled binding we
// load manually; see src/file/watcher.ts for the reference pattern.
import { createWrapper } from "@parcel/watcher/wrapper"
import type ParcelWatcher from "@parcel/watcher"
import * as NFS from "node:fs/promises"
import { Shell } from "@/shell/shell"
import { Workspace as WorkspaceErrors } from "../errors"
import type { Workspace } from "../types"

declare const OPENCODE_LIBC: string | undefined

export namespace LocalBackend {
  export interface Config {
    readonly worktree: string
  }

  const BACKEND_ID = "local"

  const toBackendError =
    (method: string, p?: string) =>
    (cause: unknown): WorkspaceErrors.BackendError =>
      new WorkspaceErrors.BackendError({
        backend: BACKEND_ID,
        method,
        path: p,
        cause: cause instanceof Error ? cause : new Error(String(cause)),
      })

  const fileType = (stat: import("node:fs").Stats): Workspace.FileType => {
    if (stat.isFile()) return "file"
    if (stat.isDirectory()) return "directory"
    if (stat.isSymbolicLink()) return "symlink"
    return "other"
  }

  const direntType = (ent: import("node:fs").Dirent): Workspace.FileType => {
    if (ent.isFile()) return "file"
    if (ent.isDirectory()) return "directory"
    if (ent.isSymbolicLink()) return "symlink"
    return "other"
  }

  const loadParcelWatcher = (): typeof import("@parcel/watcher") | undefined => {
    try {
      const libc = typeof OPENCODE_LIBC !== "undefined" && OPENCODE_LIBC ? OPENCODE_LIBC : "glibc"
      const name = `@parcel/watcher-${process.platform}-${process.arch}${
        process.platform === "linux" ? `-${libc}` : ""
      }`
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const binding = require(name)
      return createWrapper(binding) as typeof import("@parcel/watcher")
    } catch {
      return undefined
    }
  }

  const parcelBackend = (): ParcelWatcher.BackendType | undefined => {
    if (process.platform === "win32") return "windows"
    if (process.platform === "darwin") return "fs-events"
    if (process.platform === "linux") return "inotify"
    return undefined
  }

  export const make = (
    config: Config,
  ): Effect.Effect<Workspace.Backend, never, ChildProcessSpawner | Scope.Scope> =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const rootPath = path.resolve(config.worktree)

      const stat: Workspace.Backend["stat"] = (p) =>
        // `stat` (not `lstat`) — the Backend contract follows symlinks so
        // that callers treating a symlinked file as a file Just Work.
        Effect.tryPromise({
          try: () => NFS.stat(p),
          catch: toBackendError("stat", p),
        }).pipe(
          Effect.map((s) => ({
            type: fileType(s),
            size: s.size,
            mtime: s.mtime,
          })),
        )

      const exists: Workspace.Backend["exists"] = (p) =>
        Effect.tryPromise({
          try: async () => {
            try {
              await NFS.stat(p)
              return true
            } catch (e: any) {
              if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return false
              throw e
            }
          },
          catch: toBackendError("exists", p),
        })

      const readFile: Workspace.Backend["readFile"] = (p) =>
        Effect.tryPromise({
          try: () => NFS.readFile(p),
          catch: toBackendError("readFile", p),
        }).pipe(Effect.map((b) => new Uint8Array(b.buffer, b.byteOffset, b.byteLength)))

      // NOTE: raw write. Parent-directory creation is a Workspace.Service
      // concern, not a Backend primitive. If the parent is missing we let
      // NFS.writeFile throw ENOENT.
      const writeFile: Workspace.Backend["writeFile"] = (p, data) =>
        Effect.tryPromise({
          try: () => NFS.writeFile(p, data),
          catch: toBackendError("writeFile", p),
        })

      const mkDir: Workspace.Backend["mkDir"] = (p, opts) =>
        Effect.tryPromise({
          try: async () => {
            await NFS.mkdir(p, { recursive: opts.recursive })
          },
          catch: toBackendError("mkDir", p),
        })

      const readDir: Workspace.Backend["readDir"] = (p) =>
        Effect.tryPromise({
          try: () => NFS.readdir(p, { withFileTypes: true }),
          catch: toBackendError("readDir", p),
        }).pipe(
          Effect.map((entries) =>
            entries.map((ent) => ({
              name: ent.name,
              type: direntType(ent),
            })),
          ),
        )

      const remove: Workspace.Backend["remove"] = (p, opts) =>
        Effect.tryPromise({
          try: () => NFS.rm(p, { recursive: opts.recursive, force: false }),
          catch: toBackendError("remove", p),
        })

      const rename: Workspace.Backend["rename"] = (from, to) =>
        Effect.tryPromise({
          try: () => NFS.rename(from, to),
          catch: toBackendError("rename", from),
        })

      const execStream: Workspace.Backend["execStream"] = (cmd, args, opts) => {
        const program: Effect.Effect<Workspace.ExecStreamHandle, WorkspaceErrors.BackendError, Scope.Scope> =
          Effect.gen(function* () {
            const command = ChildProcess.make(cmd, args, {
              cwd: opts?.cwd,
              env: opts?.env,
              extendEnv: opts?.env === undefined,
            })
            const handle = yield* spawner.spawn(command).pipe(Effect.mapError(toBackendError("execStream")))

            // If caller supplied initial stdin bytes, feed them to the
            // handle's stdin sink eagerly. Fork so the caller can still
            // stream more bytes via the returned handle's stdin Sink.
            if (opts?.stdin !== undefined) {
              const bytes =
                typeof opts.stdin === "string" ? new TextEncoder().encode(opts.stdin) : opts.stdin
              const initial = Stream.fromIterable([bytes])
              yield* Effect.forkScoped(Stream.run(initial, handle.stdin).pipe(Effect.ignore))
            }

            if (opts?.signal) {
              const signal = opts.signal
              const abortWatch: Effect.Effect<void> = Effect.callback<void>((resume) => {
                const onAbort = () => {
                  Effect.runFork(handle.kill().pipe(Effect.ignore))
                  resume(Effect.void)
                }
                if (signal.aborted) {
                  onAbort()
                  return
                }
                signal.addEventListener("abort", onAbort, { once: true })
                return Effect.sync(() => signal.removeEventListener("abort", onAbort))
              })
              yield* Effect.forkScoped(abortWatch)
            }

            const killEff: Effect.Effect<void> = handle.kill().pipe(Effect.ignore) as Effect.Effect<void>

            const baseExit: Effect.Effect<number | null, WorkspaceErrors.BackendError> = handle.exitCode.pipe(
              Effect.map((code) => code as number | null),
              Effect.mapError(toBackendError("execStream.exitCode")),
            )
            const withTimeout: Effect.Effect<number | null, WorkspaceErrors.BackendError> = opts?.timeoutMs
              ? Effect.timeoutOrElse(baseExit, {
                  duration: `${opts.timeoutMs} millis`,
                  orElse: () =>
                    Effect.fail(
                      toBackendError("execStream.timeout")(
                        new Error(`exec timed out after ${opts.timeoutMs}ms`),
                      ),
                    ),
                })
              : baseExit

            const stdinSink: Sink.Sink<void, Uint8Array, never, WorkspaceErrors.BackendError> = handle.stdin.pipe(
              Sink.mapError(toBackendError("execStream.stdin")),
            )

            const result: Workspace.ExecStreamHandle = {
              stdin: stdinSink,
              stdout: handle.stdout.pipe(Stream.mapError(toBackendError("execStream.stdout"))),
              stderr: handle.stderr.pipe(Stream.mapError(toBackendError("execStream.stderr"))),
              all: handle.all.pipe(Stream.mapError(toBackendError("execStream.all"))),
              exitCode: withTimeout,
              kill: killEff,
            }
            return result
          })
        return program
      }

      // exec() is execStream() + collect. ZERO duplication.
      const exec: Workspace.Backend["exec"] = (cmd, args, opts) =>
        Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* execStream(cmd, args, opts)
            const decoder = new TextDecoder()
            const collect = (
              s: Stream.Stream<Uint8Array, WorkspaceErrors.BackendError>,
            ): Effect.Effect<string, WorkspaceErrors.BackendError> =>
              Stream.runFold(
                s,
                () => "",
                (acc, chunk) => acc + decoder.decode(chunk, { stream: true }),
              )

            const stdoutFiber = yield* Effect.forkChild(collect(handle.stdout))
            const stderrFiber = yield* Effect.forkChild(collect(handle.stderr))
            const code = yield* handle.exitCode
            const stdout = yield* Fiber.join(stdoutFiber)
            const stderr = yield* Fiber.join(stderrFiber)
            const result: Workspace.ExecResult = { exitCode: code ?? -1, stdout, stderr }
            return result
          }),
        )

      const watch: Workspace.Backend["watch"] = (p, opts) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const w = loadParcelWatcher()
            if (!w) {
              return Stream.fail(
                toBackendError("watch", p)(new Error("parcel watcher binding unavailable")),
              ) as Stream.Stream<Workspace.FsEvent, WorkspaceErrors.BackendError>
            }
            const pbackend = parcelBackend()
            if (!pbackend) {
              return Stream.fail(
                toBackendError("watch", p)(new Error(`unsupported platform for watch: ${process.platform}`)),
              ) as Stream.Stream<Workspace.FsEvent, WorkspaceErrors.BackendError>
            }

            const queue = yield* Queue.unbounded<Workspace.FsEvent, WorkspaceErrors.BackendError | Cause.Done>()

            const pending = w.subscribe(
              p,
              (err, evts) => {
                if (err) {
                  Queue.failCauseUnsafe(queue, Cause.fail(toBackendError("watch", p)(err)))
                  return
                }
                for (const evt of evts) {
                  let type: Workspace.FsEventType | undefined
                  if (evt.type === "create") type = "add"
                  else if (evt.type === "update") type = "change"
                  else if (evt.type === "delete") type = "unlink"
                  if (type) Queue.offerUnsafe(queue, { type, path: evt.path })
                }
              },
              { backend: pbackend, ignore: opts?.ignore ? [...opts.ignore] : undefined },
            )

            const sub = yield* Effect.tryPromise({
              try: () => pending,
              catch: toBackendError("watch", p),
            })

            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                yield* Effect.promise(() => sub.unsubscribe().catch(() => {}))
                yield* Queue.end(queue)
              }),
            )

            return Stream.fromQueue(queue)
          }),
        )

      const backend: Workspace.Backend = {
        id: BACKEND_ID,
        rootPath,
        shell: Shell.acceptable(),
        stat,
        exists,
        readFile,
        writeFile,
        mkDir,
        readDir,
        remove,
        rename,
        exec,
        execStream,
        watch,
        close: Effect.void,
      }
      return backend
    })
}
