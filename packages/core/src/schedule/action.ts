export * as ScheduleAction from "./action.js"

import { durationMillis, type Schedule as ScheduleSchema } from "@opencode/schema/schedule"
import { Clock, Duration, Effect, Option, Result, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { Environment } from "../environment/index.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin.js"
import type { SessionSchema } from "../session/schema.js"
import { ShellSelect } from "../shell/select.js"
import { assertShellPermissions, MAX_OUTPUT_BYTES, scanShell, utf8Decode } from "./check.js"

const DEFAULT_TIMEOUT = "10 minutes"
const DEFAULT_TIMEOUT_MS = 10 * 60_000

/** Retains only the last `buffer.length` bytes of output without growing past it. */
interface Tail {
  readonly buffer: Uint8Array
  size: number
  dropped: boolean
}

/**
 * Runs in the Session's Location while the user is present, asking once for the shell and `external_directory`
 * permissions a shell action needs. Nothing is saved: every run is authorized again unattended.
 */
export const authorize = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  name: string | undefined,
  when: ScheduleSchema.When,
  action: ScheduleSchema.ShellAction,
) {
  yield* Plugin.awaitActivation
  const scanned = yield* scanShell(action.run, action.cwd)
  yield* assertShellPermissions(session, scanned, {
    schedule: name,
    when,
    unattended: true,
    run: action.run,
    ...(action.cwd === undefined ? {} : { cwd: action.cwd }),
  })
})

/**
 * Runs one shell action under narrow unattended permissions. Never fails: every outcome becomes a run result. Without a
 * Session it runs in the global config Location and asks for nothing, because the caller that created it is trusted.
 * A check's `message` arrives on stdin with a trailing newline and in `OPENCODE_SCHEDULE_MESSAGE`.
 */
export const run = Effect.fnUntraced(function* (
  session: SessionSchema.Info | undefined,
  action: ScheduleSchema.ShellAction,
  env: Record<string, string>,
  message?: string,
) {
  const text = message?.trim() || undefined
  const environment = yield* Environment.Service
  const start = yield* Clock.currentTimeMillis
  const elapsed = Clock.currentTimeMillis.pipe(Effect.map((now) => now - start))

  yield* Plugin.awaitActivation

  const scannedExit = yield* Effect.result(scanShell(action.run, action.cwd))
  if (Result.isFailure(scannedExit))
    return yield* elapsed.pipe(Effect.map((durationMs) => ({ durationMs, output: "", error: scannedExit.failure })))
  const scanned = scannedExit.success

  const unattended: Permission.Ruleset = [
    ...scanned.external.map((resource) => ({ action: "external_directory", resource, effect: "allow" as const })),
    ...scanned.commands.map((resource) => ({ action: "shell", resource, effect: "allow" as const })),
  ]
  const authorized = yield* assertShellPermissions(session, scanned).pipe(
    Effect.provideService(Permission.Unattended, unattended),
    Effect.result,
  )
  if (Result.isFailure(authorized))
    return yield* elapsed.pipe(
      Effect.map((durationMs) => ({ durationMs, output: "", error: authorized.failure.message })),
    )

  // The tail lives outside the timeout, so output produced before a timeout survives it.
  const tail: Tail = { buffer: new Uint8Array(MAX_OUTPUT_BYTES), size: 0, dropped: false }
  const timeoutMs =
    action.timeout === undefined
      ? DEFAULT_TIMEOUT_MS
      : Option.getOrElse(durationMillis(action.timeout), () => DEFAULT_TIMEOUT_MS)

  const executed = yield* Effect.scoped(
    Effect.gen(function* () {
      const proc = ChildProcess.make(scanned.shell, ShellSelect.args(scanned.shell, action.run), {
        cwd: scanned.cwd,
        env: {
          ...(scanned.workspaceID === undefined ? process.env : {}),
          ...(text === undefined ? {} : { OPENCODE_SCHEDULE_MESSAGE: text }),
          ...env,
        },
        // Never a pipe without a message: a command that reads stdin would wait for the 10 minute timeout.
        stdin: text === undefined ? "ignore" : Stream.encodeText(Stream.make(text + "\n")),
        detached: process.platform !== "win32",
        forceKillAfter: Duration.seconds(3),
      })
      const handle = yield* environment.spawner.spawn(proc)
      const [, exitCode] = yield* Effect.all(
        [Stream.runForEach(handle.all, (chunk) => Effect.sync(() => appendTail(tail, chunk))), handle.exitCode],
        { concurrency: "unbounded" },
      )
      return exitCode
    }),
  ).pipe(Effect.timeoutOption(timeoutMs), Effect.result)

  // A slice can cut a UTF-8 sequence, so skip its leading continuation bytes before decoding.
  const textStart = firstTextByte(tail)
  const decoded = utf8Decode(tail.buffer.subarray(textStart, tail.size))
  const output = tail.dropped ? `[output truncated at ${MAX_OUTPUT_BYTES / 1024} KB]\n${decoded}` : decoded

  if (Result.isFailure(executed)) {
    const cause = executed.failure
    const error = cause instanceof Error ? cause.message : String(cause)
    return yield* elapsed.pipe(Effect.map((durationMs) => ({ durationMs, output, error })))
  }
  if (Option.isNone(executed.success))
    return yield* elapsed.pipe(
      Effect.map((durationMs) => ({
        durationMs,
        output,
        error: `Timed out after ${action.timeout ?? DEFAULT_TIMEOUT}`,
      })),
    )
  return yield* elapsed.pipe(
    Effect.map((durationMs) => ({ durationMs, exitCode: Number(Option.getOrThrow(executed.success)), output })),
  )
})

/** Overwrites the oldest bytes in place so a chatty command stays bounded at `MAX_OUTPUT_BYTES`. */
function appendTail(tail: Tail, chunk: Uint8Array) {
  if (chunk.length >= tail.buffer.length) {
    tail.dropped = tail.dropped || tail.size + chunk.length > tail.buffer.length
    tail.buffer.set(chunk.subarray(chunk.length - tail.buffer.length))
    tail.size = tail.buffer.length
    return
  }
  const overflow = Math.max(0, tail.size + chunk.length - tail.buffer.length)
  if (overflow > 0) {
    tail.buffer.copyWithin(0, overflow, tail.size)
    tail.size -= overflow
    tail.dropped = true
  }
  tail.buffer.set(chunk, tail.size)
  tail.size += chunk.length
}

/** Skips the continuation bytes of a UTF-8 sequence that the tail cut in half. */
function firstTextByte(tail: Tail) {
  let start = 0
  while (start < tail.size && (tail.buffer[start] & 0xc0) === 0x80) start++
  return start
}
