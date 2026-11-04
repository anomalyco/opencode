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

/** Runs one shell action under narrow unattended permissions. Never fails: every outcome becomes a run result. */
export const run = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  action: ScheduleSchema.ShellAction,
  env: Record<string, string>,
) {
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

  // The accumulator lives outside the timeout, so output produced before a timeout survives it.
  const collected = { chunks: [] as Uint8Array[], bytes: 0, truncated: false }
  const timeoutMs =
    action.timeout === undefined
      ? DEFAULT_TIMEOUT_MS
      : Option.getOrElse(durationMillis(action.timeout), () => DEFAULT_TIMEOUT_MS)

  const executed = yield* Effect.scoped(
    Effect.gen(function* () {
      const proc = ChildProcess.make(scanned.shell, ShellSelect.args(scanned.shell, action.run), {
        cwd: scanned.cwd,
        env: { ...(scanned.workspaceID === undefined ? process.env : {}), ...env },
        stdin: "ignore",
        detached: process.platform !== "win32",
        forceKillAfter: Duration.seconds(3),
      })
      const handle = yield* environment.spawner.spawn(proc)
      const [, exitCode] = yield* Effect.all(
        [
          Stream.runForEach(handle.all, (chunk) =>
            Effect.sync(() => {
              const remaining = MAX_OUTPUT_BYTES - collected.bytes
              if (remaining > 0) collected.chunks.push(remaining >= chunk.length ? chunk : chunk.slice(0, remaining))
              collected.bytes += chunk.length
              collected.truncated = collected.truncated || collected.bytes > MAX_OUTPUT_BYTES
            }),
          ),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      )
      return exitCode
    }),
  ).pipe(Effect.timeoutOption(timeoutMs), Effect.result)

  const output =
    utf8Decode(Buffer.concat(collected.chunks)) + (collected.truncated ? "\n[output truncated at 32 KB]" : "")

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
