export * as ScheduleCheck from "./check.js"

import { isRecord } from "@opencode/util/record"
import { collectStream } from "@opencode/util/process"
import type { Schedule as ScheduleSchema } from "@opencode/schema/schedule"
import { Array, Duration, Effect, Option, Result, type Schema } from "effect"
import { ChildProcess } from "effect/process"
import { Agent } from "../agent.js"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { Location } from "../location.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin.js"
import type { SessionSchema } from "../session/schema.js"
import { ShellParse } from "../shell/parse.js"
import { ShellSelect } from "../shell/select.js"

export const TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 32 * 1024

export type Outcome =
  | {
      readonly ok: true
      readonly wake: boolean
      readonly state: Schema.Json
      readonly message?: string
    }
  | {
      readonly ok: false
      readonly error: string
    }

/** Validates condition syntax synchronously before asking for permissions or spawning anything. */
export function validate(condition: ScheduleSchema.Condition): Result.Result<void, string> {
  switch (condition.type) {
    case "shell": {
      if (condition.run.trim() === "") return Result.fail("A shell check needs a command")
      const predicates = [
        condition.is !== undefined,
        condition.matches !== undefined,
        condition.changes !== undefined,
      ].filter(Boolean).length
      if (predicates > 1) return Result.fail("Choose at most one of is, matches or changes")
      if (condition.matches === undefined) return Result.succeed(undefined)
      return Result.try({
        try: () => {
          new RegExp(condition.matches!)
        },
        catch: (cause) =>
          `Invalid regular expression ${JSON.stringify(condition.matches)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      })
    }
  }
}

export function describe(condition: ScheduleSchema.Condition): string {
  switch (condition.type) {
    case "shell":
      return condition.run
  }
}

/** Runs in the Session's Location while the user is present; approves required permissions once without saving. */
export const authorize = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  name: string | undefined,
  check: ScheduleSchema.StoredCheck,
) {
  const plugins = yield* Plugin.Service
  yield* plugins.awaitActivation
  switch (check.condition.type) {
    case "shell":
      return yield* authorizeShell(session, name, check.mode, check.condition)
  }
})

/** Runs one check in the Session's Location under narrow unattended permissions and a 30s wall-clock cap. */
export const evaluate = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  check: ScheduleSchema.StoredCheck,
  prevState: Schema.Json,
) {
  const run = Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    yield* plugins.awaitActivation
    switch (check.condition.type) {
      case "shell":
        return yield* runShell(session, check.condition, prevState)
    }
  })
  return yield* run.pipe(
    Effect.timeoutOption(TIMEOUT_MS),
    Effect.map((result): Outcome =>
      Option.match(result, {
        onNone: () => ({ ok: false, error: `Check timed out after ${TIMEOUT_MS}ms` }),
        onSome: (outcome) => outcome,
      }),
    ),
  )
})

const scanShell = Effect.fnUntraced(function* (command: string) {
  const location = yield* Location.Service
  const access = yield* FileAccess.Service
  const shellSelect = yield* ShellSelect.Service
  const target = yield* access
    .resolve({ path: location.directory, kind: "directory" })
    .pipe(Effect.mapError((error) => error.message))
  const shell = yield* shellSelect.resolve({ priority: "compat" })
  const parsed = yield* ShellParse.scanPortable(command, shell, target.absolute).pipe(
    Effect.mapError((error) => error.message),
  )
  const directories = yield* Effect.forEach(parsed.directories, (directory) =>
    access
      .resolve({ path: FileAccess.resolvePath(target.absolute, directory), kind: "directory" })
      .pipe(Effect.mapError((error) => error.message)),
  )
  const external = Array.dedupe(
    [target, ...directories].flatMap((item) => (item.externalDirectory ? [item.externalDirectory.resource] : [])),
  )
  const commands = Array.dedupe(parsed.commands.map((item) => item.resource))
  return { shell, cwd: target.absolute, workspaceID: location.workspaceID, external, commands }
})

const assertShellPermissions = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  scanned: { readonly external: ReadonlyArray<string>; readonly commands: ReadonlyArray<string> },
  metadata?: Record<string, unknown>,
) {
  const permission = yield* Permission.Service
  const agents = yield* Agent.Service
  const agent = yield* agents.select(session.agent)
  if (scanned.external.length > 0) {
    yield* permission.assert({
      action: "external_directory",
      resources: [...scanned.external],
      ...(metadata === undefined ? {} : { metadata }),
      sessionID: session.id,
      agent: agent.id,
    })
  }
  if (scanned.commands.length > 0) {
    yield* permission.assert({
      action: "shell",
      resources: [...scanned.commands],
      ...(metadata === undefined ? {} : { metadata }),
      sessionID: session.id,
      agent: agent.id,
    })
  }
})

const authorizeShell = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  name: string | undefined,
  mode: ScheduleSchema.CheckMode,
  condition: ScheduleSchema.ShellCondition,
) {
  const scanned = yield* scanShell(condition.run)
  yield* assertShellPermissions(session, scanned, {
    schedule: name,
    mode,
    run: condition.run,
  })
})

const runShell = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  condition: ScheduleSchema.ShellCondition,
  prevState: Schema.Json,
) {
  const environment = yield* Environment.Service
  const scannedExit = yield* Effect.result(scanShell(condition.run))
  if (Result.isFailure(scannedExit)) return { ok: false, error: scannedExit.failure } satisfies Outcome
  const scanned = scannedExit.success
  const unattended: Permission.Ruleset = [
    ...scanned.external.map((resource) => ({ action: "external_directory", resource, effect: "allow" as const })),
    ...scanned.commands.map((resource) => ({ action: "shell", resource, effect: "allow" as const })),
  ]
  const authorized = yield* assertShellPermissions(session, scanned).pipe(
    Effect.provideService(Permission.Unattended, unattended),
    Effect.result,
  )
  if (Result.isFailure(authorized)) return { ok: false as const, error: authorized.failure.message }

  const executed = yield* Effect.scoped(
    Effect.gen(function* () {
      const proc = ChildProcess.make(scanned.shell, ShellSelect.args(scanned.shell, condition.run), {
        cwd: scanned.cwd,
        ...(scanned.workspaceID === undefined ? { env: process.env } : {}),
        stdin: "ignore",
        detached: process.platform !== "win32",
        forceKillAfter: Duration.seconds(3),
      })
      const handle = yield* environment.spawner.spawn(proc)
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectStream(handle.stdout, MAX_OUTPUT_BYTES),
          collectStream(handle.stderr, MAX_OUTPUT_BYTES),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      )
      return {
        exitCode,
        stdout: utf8Decode(stdout.buffer),
        stderr: utf8Decode(stderr.buffer),
      }
    }),
  ).pipe(Effect.result)

  if (Result.isFailure(executed)) {
    return {
      ok: false as const,
      error: executed.failure instanceof Error ? executed.failure.message : String(executed.failure),
    }
  }

  const output = executed.success
  const trimmed = output.stdout.trim()
  const message = trimmed === "" ? undefined : trimmed
  const hasPredicate =
    condition.is !== undefined || condition.matches !== undefined || condition.changes === true

  if (!hasPredicate) {
    return {
      ok: true as const,
      wake: output.exitCode === 0,
      state: null,
      ...(output.exitCode === 0 && message !== undefined ? { message } : {}),
    }
  }

  if (output.exitCode !== 0) {
    const detail = output.stderr.trim() || trimmed
    return {
      ok: false as const,
      error: `Command exited with code ${output.exitCode}${detail ? `: ${detail}` : ""}`,
    }
  }

  if (condition.is !== undefined) {
    const wake = trimmed === condition.is.trim()
    return { ok: true as const, wake, state: null, ...(wake && message !== undefined ? { message } : {}) }
  }

  if (condition.matches !== undefined) {
    const wake = new RegExp(condition.matches).test(output.stdout)
    return { ok: true as const, wake, state: null, ...(wake && message !== undefined ? { message } : {}) }
  }

  const prevStdout = isRecord(prevState) && typeof prevState.stdout === "string" ? prevState.stdout : null
  const wake = prevStdout !== null && output.stdout !== prevStdout
  return {
    ok: true as const,
    wake,
    state: { stdout: output.stdout },
    ...(wake && message !== undefined ? { message } : {}),
  }
})

function utf8Decode(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes)
  return text.endsWith("\uFFFD") ? text.slice(0, -1) : text
}
