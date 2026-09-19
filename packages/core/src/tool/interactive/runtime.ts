export * as InteractiveProcess from "./runtime"

import { Cause, Context, Deferred, Effect, Layer, Queue, Schema, Stream } from "effect"
import { PlatformError, SystemError } from "effect/PlatformError"
import type { Duration } from "effect"
import type { Disp } from "#pty"
import { makeLocationNode } from "../../effect/app-node"
import { lazy } from "../../util/lazy"

// The PTY module ships native binaries; load it lazily so merely constructing
// the service never touches native code.
const ptyModule = lazy(() => import("#pty"))

const defaultShell = () => (process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh")

const SIGNAL_NAMES: Record<number, string> = { 1: "SIGHUP", 2: "SIGINT", 9: "SIGKILL", 15: "SIGTERM" }

const signalName = (signal: number | string) =>
  typeof signal === "string" ? signal : (SIGNAL_NAMES[signal] ?? `SIG${signal}`)

const platformError = (method: string, cause: unknown) =>
  new PlatformError(new SystemError({ _tag: "Unknown", module: "InteractiveProcess", method, cause }))

const signalGroup = (pgid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pgid, signal)
  } catch {}
}

/**
 * How the child's exit was observed (spec R5). `exitCode` is the numeric exit
 * status; `signal` names a fatal signal when the child was killed instead of
 * exiting on its own. A spawn failure is not an exit — it fails `spawn`.
 */
export interface ExitStatus {
  readonly exitCode?: number
  readonly signal?: string
}

/**
 * One live interactive child (spec R22): spawned under a PTY in its own
 * session (POSIX) or a ConPTY (Windows) so prompt/isatty-dependent programs
 * behave. stdout and stderr arrive merged on `output`.
 *
 * Ownership contract (spec R23): the job store owns the returned child —
 * callers must eventually `kill` it or consume `exit`; the runtime closing
 * all masters (children receive SIGHUP) plus the ledger startup sweep
 * (spec R30) are the backstops for children that survive. The service is a
 * port so tests substitute a scripted fake child (spec R34).
 */
export interface Child {
  /** Process group id of the child; recorded in the orphan ledger (spec R30). */
  readonly pgid: number
  /** Merged (stdout+stderr) byte stream from the PTY master. */
  readonly output: Stream.Stream<Uint8Array, PlatformError>
  /**
   * Append exact bytes to the child's stdin (the PTY master). The caller
   * includes the trailing newline; `signalEof` sends ^D separately.
   */
  readonly write: (bytes: string) => Effect.Effect<void, PlatformError>
  /** Signal end-of-input (^D on the PTY) after pending writes. */
  readonly signalEof: () => Effect.Effect<void>
  /** Completes once when the child exits; safe to race against settle timers. */
  readonly exit: Effect.Effect<ExitStatus>
  /**
   * Kill the whole process group: SIGTERM, then SIGKILL after `grace`
   * (default 3 s, matching bash), then close the PTY master. Idempotent.
   */
  readonly kill: (grace?: Duration.Input) => Effect.Effect<void>
}

/** Spawn request executed like bash's: a shell command string under `shell`. */
export interface SpawnRequest {
  readonly command: string
  readonly shell?: string
  readonly cwd: string
  readonly env?: Record<string, string>
}

export class SpawnError extends Schema.TaggedErrorClass<SpawnError>()("InteractiveProcess.SpawnError", {
  command: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    const detail = this.cause instanceof Error ? this.cause.message : String(this.cause)
    return `Failed to spawn interactive process: ${this.command}${detail ? `: ${detail}` : ""}`
  }
}

/**
 * PTY spawn port (spec R22/R34). `pty` reports whether the live layer runs
 * children under a terminal (true for the shared `#pty` port, including the
 * Windows ConPTY path). Tests replace the whole service with a fake child
 * replaying scripted `(bytes, delay)` events.
 */
export interface Interface {
  readonly pty: boolean
  readonly spawn: (request: SpawnRequest) => Effect.Effect<Child, SpawnError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/InteractiveProcess") {}

/**
 * Live PTY spawn (spec R22): the child runs under a PTY via the shared `#pty`
 * port (bun-pty under Bun, @lydell/node-pty under Node), which starts it as a
 * session leader on POSIX — so `pgid` is the child's pid and killing the group
 * reaps the whole tree (spec R30). Windows is covered by ConPTY through the
 * same port; a missing native binary fails `spawn` per spec R8.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawn = Effect.fn("InteractiveProcess.spawn")(function* (request: SpawnRequest) {
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value
      }
      Object.assign(env, request.env ?? {}, { TERM: env.TERM ?? "xterm-256color" })
      const shell = request.shell ?? defaultShell()
      const mod = yield* Effect.tryPromise({
        try: () => ptyModule(),
        catch: (cause) => new SpawnError({ command: request.command, cause }),
      })
      const proc = yield* Effect.try({
        try: () => mod.spawn(shell, ["-c", request.command], { name: "xterm-256color", cwd: request.cwd, env }),
        catch: (cause) => new SpawnError({ command: request.command, cause }),
      })

      const queue = yield* Queue.unbounded<Uint8Array, Cause.Done>()
      const exited = yield* Deferred.make<ExitStatus>()
      let done = false
      const complete = (status: ExitStatus) => {
        if (done) return
        done = true
        // the Done mark ends the output stream after every queued chunk
        Queue.endUnsafe(queue)
        Deferred.doneUnsafe(exited, Effect.succeed(status))
      }
      const listeners: Disp[] = [
        proc.onData((chunk) => {
          Queue.offerUnsafe(queue, Buffer.from(chunk, "utf8"))
        }),
        proc.onExit(({ exitCode, signal }) => {
          complete(signal === undefined || signal === 0 ? { exitCode } : { signal: signalName(signal) })
        }),
      ]

      return {
        // node-pty/bun-pty make the child a session leader on POSIX, so pgid == pid
        pgid: proc.pid,
        output: Stream.fromQueue(queue),
        write: (bytes) =>
          Effect.try({
            try: () => proc.write(bytes),
            catch: (cause) => platformError("write", cause),
          }),
        // ^D on the PTY master
        signalEof: () => Effect.sync(() => proc.write("\u0004")),
        exit: Deferred.await(exited),
        kill: (grace?: Duration.Input) =>
          // the SIGTERM → SIGKILL escalation runs uninterruptibly: a fiber
          // interrupted between the steps must not leave the group half-killed
          // with the PTY master open (spec R14/R23)
          Effect.uninterruptible(
            Effect.gen(function* () {
              const deadline = grace ?? "3 seconds"
              if (process.platform !== "win32") signalGroup(proc.pid, "SIGTERM")
              // deliver directly too: on Windows the group signal does not apply,
              // and the direct kill starts closing the PTY master everywhere
              try {
                proc.kill("SIGTERM")
              } catch {}
              yield* Effect.race(Deferred.await(exited), Effect.sleep(deadline))
              if (!done) {
                if (process.platform !== "win32") signalGroup(proc.pid, "SIGKILL")
                try {
                  proc.kill("SIGKILL")
                } catch {}
                yield* Effect.race(Deferred.await(exited), Effect.sleep("1 second"))
              }
              for (const listener of listeners) listener.dispose()
            }),
          ),
      } satisfies Child
    })

    return Service.of({ pty: true, spawn })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [] })
