import { Cause, Effect, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Shell } from "@opencode-ai/core/shell"
import { monitorPid, monitorStarted, monitorStopped } from "@opencode-ai/core/background-monitor"

/** Build a detached login-shell command (same env/flags the old monitor used). */
export function makeShellCommand(command: string, cwd: string): ChildProcess.Command {
  const shell = Shell.acceptable()
  const args = Shell.args(shell, command, cwd)
  return ChildProcess.make(shell, args, {
    cwd,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      TERM: "xterm-256color",
      PAGER: "cat",
      GIT_PAGER: "cat",
    },
  })
}

/**
 * A fully-provided (`R = never`) Effect suitable as a `BackgroundJob` `run`:
 * spawns `command`, tracks session liveness + PID (so the CLI defers exit and
 * SIGINT can kill it), streams stdout line-by-line to `onLine` (when given),
 * and resolves to the exit reason string. The process is killed when the job's
 * scope closes (i.e. on `BackgroundJob.cancel` / session teardown) via the
 * scoped spawn + an explicit kill finalizer.
 */
export function runShellJob(opts: {
  sessionID: string
  command: ChildProcess.Command
  onLine?: (line: string) => Effect.Effect<void>
}): Effect.Effect<string, unknown, ChildProcessSpawner> {
  return Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      monitorStarted(opts.sessionID)
      let pid: number | undefined
      yield* Effect.addFinalizer(() => Effect.sync(() => monitorStopped(opts.sessionID, pid)))

      const handle = yield* spawner.spawn(opts.command)
      pid = Number(handle.pid)
      monitorPid(opts.sessionID, pid)
      yield* Effect.addFinalizer(() => handle.kill().pipe(Effect.ignore))

      if (opts.onLine) {
        const buffer = { value: "" }
        yield* Stream.runForEach(handle.stdout, (chunk) =>
          Effect.gen(function* () {
            buffer.value += new TextDecoder().decode(chunk as Uint8Array)
            const lines = buffer.value.split(/\r?\n/)
            buffer.value = lines.pop() ?? ""
            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed) continue
              yield* opts.onLine!(trimmed)
            }
          }),
        )
        const trailing = buffer.value.trim()
        if (trailing) yield* opts.onLine!(trailing)
      }

      return yield* handle.exitCode.pipe(
        Effect.matchCause({
          onSuccess: (code) => `exit code ${code}`,
          onFailure: (cause) => `signal or error: ${Cause.squash(cause)}`,
        }),
      )
    }),
  )
}
