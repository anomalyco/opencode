export * as ScheduleCheck from "./check.js"

import { CodeMode } from "@opencode/codemode"
import { isRecord } from "@opencode/util/record"
import { collectStream } from "@opencode/util/process"
import type { Schedule as ScheduleSchema } from "@opencode/schema/schedule"
import { Array, Duration, Effect, Option, Result, Schema } from "effect"
import { ChildProcess } from "effect/process"
import { Agent } from "../agent.js"
import { CodeModeTool } from "../codemode/tool.js"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { Location } from "../location.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin.js"
import type { SessionMessage } from "../session/message.js"
import type { SessionSchema } from "../session/schema.js"
import { ShellParse } from "../shell/parse.js"
import { ShellSelect } from "../shell/select.js"
import { Tool } from "../tool.js"
import { McpTool } from "../tool/mcp.js"

export const TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 32 * 1024
const CODE_LIMITS: CodeMode.ExecutionLimits = {
  timeoutMs: TIMEOUT_MS,
  maxToolCalls: 20,
  maxOutputBytes: MAX_OUTPUT_BYTES,
}

const FORBIDDEN_CODE_TOOLS = new Set([
  "opencode.schedule_create",
  "opencode.schedule_pause",
  "opencode.schedule_resume",
  "opencode.schedule_delete",
  "opencode.session_move",
  "opencode.session_rename",
  "opencode.worktree_create",
  "opencode.worktree_remove",
])

const decodeCodeObjectResult = Schema.decodeUnknownResult(
  Schema.Struct({
    wake: Schema.Boolean,
    state: Schema.optionalKey(Schema.Json),
    message: Schema.optionalKey(Schema.String),
  }),
)

export interface RunContext {
  readonly messageID: SessionMessage.ID
  readonly now: number
  readonly checks: number
}

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
      readonly invalid?: boolean
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
    case "code": {
      const scanned = CodeMode.scanTools(condition.code)
      if (Result.isFailure(scanned)) return Result.fail(scanned.failure.message)
      for (const path of scanned.success) {
        if (FORBIDDEN_CODE_TOOLS.has(path)) {
          return Result.fail(`Tool ${path} cannot be used inside a schedule check`)
        }
      }
      return Result.succeed(undefined)
    }
  }
}

export function describe(condition: ScheduleSchema.Condition): string {
  switch (condition.type) {
    case "shell":
      return condition.run
    case "code": {
      const line = condition.code
        .split("\n")
        .map((item) => item.trim())
        .find((item) => item.length > 0)
      return line ? `code (${line.slice(0, 60)})` : "code"
    }
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
    case "code":
      return yield* authorizeCode(session, name, check.mode, check.condition)
  }
})

/** Runs one check in the Session's Location under narrow unattended permissions and a 30s wall-clock cap. */
export const evaluate = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  check: ScheduleSchema.StoredCheck,
  prevState: Schema.Json,
  context: RunContext,
) {
  const run = Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    yield* plugins.awaitActivation
    switch (check.condition.type) {
      case "shell":
        return yield* runShell(session, check.condition, prevState)
      case "code":
        return yield* runCode(session, check.condition, prevState, context)
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

const resolveCodeTools = Effect.fnUntraced(function* (paths: ReadonlyArray<string>) {
  const mcp = yield* McpTool.Service
  const tools = yield* Tool.Service
  if (paths.length > 0) yield* mcp.flush
  const registered = yield* tools.list()
  const resolved: Array<(typeof registered)[number]> = []
  for (const path of paths) {
    if (FORBIDDEN_CODE_TOOLS.has(path)) {
      return yield* Effect.fail(`Tool ${path} cannot be used inside a schedule check`)
    }
    const found = registered.find(
      (item) => item.options?.codemode !== false && CodeModeTool.qualifiedName(item) === path,
    )
    if (!found) return yield* Effect.fail(`Unknown Code Mode tool: ${path}`)
    if (found.options?.permission === "edit") {
      return yield* Effect.fail(`Tool ${path} cannot be used inside a schedule check`)
    }
    resolved.push(found)
  }
  return { tools, resolved }
})

const authorizeCode = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  name: string | undefined,
  mode: ScheduleSchema.CheckMode,
  condition: ScheduleSchema.CodeCondition,
) {
  const permission = yield* Permission.Service
  const agents = yield* Agent.Service
  const agent = yield* agents.select(session.agent)
  const scanned = CodeMode.scanTools(condition.code)
  if (Result.isFailure(scanned)) return yield* Effect.fail(scanned.failure.message)
  const paths = scanned.success

  yield* permission.assertNotDenied({
    action: "execute",
    resources: ["*"],
    sessionID: session.id,
    agent: agent.id,
  })

  const { resolved } = yield* resolveCodeTools(paths)
  const actions = Array.dedupe(resolved.map((tool) => tool.options?.permission ?? tool.id))

  if (actions.length === 0) {
    yield* permission.assert({
      action: "execute",
      resources: ["*"],
      metadata: { schedule: name, mode, code: condition.code, tools: [] },
      sessionID: session.id,
      agent: agent.id,
    })
    return
  }

  // Fail fast on any explicit deny before asking the user to approve earlier tools.
  yield* Effect.forEach(
    actions,
    (action) =>
      permission.assertNotDenied({
        action,
        resources: ["*"],
        sessionID: session.id,
        agent: agent.id,
      }),
    { discard: true },
  )

  yield* Effect.forEach(
    actions,
    (action) =>
      permission.assert({
        action,
        resources: ["*"],
        // No `save`: "always" would save a project-wide allow, while scheduled ticks run via Unattended.
        metadata: { schedule: name, mode, code: condition.code, tools: [...paths] },
        sessionID: session.id,
        agent: agent.id,
      }),
    { discard: true },
  )
})

const runCode = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  condition: ScheduleSchema.CodeCondition,
  prevState: Schema.Json,
  context: RunContext,
) {
  const permission = yield* Permission.Service
  const agents = yield* Agent.Service
  const agent = yield* agents.select(session.agent)
  if (!agent.info) return { ok: false as const, error: `Agent not found: ${agent.id}` }

  const scanned = CodeMode.scanTools(condition.code)
  if (Result.isFailure(scanned)) return { ok: false as const, error: scanned.failure.message }
  const paths = scanned.success

  const resolvedExit = yield* Effect.result(resolveCodeTools(paths))
  if (Result.isFailure(resolvedExit)) return { ok: false as const, error: resolvedExit.failure }

  const actions = Array.dedupe(resolvedExit.success.resolved.map((tool) => tool.options?.permission ?? tool.id))
  const unattended: Permission.Ruleset = ["execute", ...actions].map((action) => ({
    action,
    resource: "*",
    effect: "allow" as const,
  }))

  const notDenied = yield* Effect.forEach(
    ["execute", ...actions],
    (action) =>
      permission.assertNotDenied({
        action,
        resources: ["*"],
        sessionID: session.id,
        agent: agent.id,
      }),
    { discard: true },
  ).pipe(Effect.provideService(Permission.Unattended, unattended), Effect.result)

  if (Result.isFailure(notDenied)) return { ok: false as const, error: notDenied.failure.message }

  const bindings: Record<string, Schema.Json> = {
    state: prevState,
    now: context.now,
    runs: context.checks,
    input: { state: prevState, now: context.now, runs: context.checks },
  }

  const result = yield* resolvedExit.success.tools
    .check({
      code: condition.code,
      tools: paths,
      bindings,
      permissions: Permission.merge(agent.info.permissions, session.permissions ?? []),
      limits: CODE_LIMITS,
      context: {
        sessionID: session.id,
        agent: agent.id,
        messageID: context.messageID,
        progress: () => Effect.void,
      },
    })
    .pipe(Effect.provideService(Permission.Unattended, unattended))

  if (!result.ok) {
    const invalid =
      result.error.kind === "ParseError" ||
      result.error.kind === "UnsupportedSyntax" ||
      result.error.kind === "UnknownTool" ||
      result.error.kind === "InvalidToolInput" ||
      result.error.message.includes("needs approval")
    return { ok: false as const, error: result.error.message, ...(invalid ? { invalid: true } : {}) }
  }
  if (typeof result.value === "boolean") {
    return { ok: true as const, wake: result.value, state: prevState }
  }
  const decoded = decodeCodeObjectResult(result.value)
  if (Result.isFailure(decoded)) {
    return {
      ok: false as const,
      error: `A code check must return a boolean or { wake, state?, message? }: ${decoded.failure}`,
      invalid: true,
    }
  }
  const state = decoded.success.state === undefined ? prevState : decoded.success.state
  const trimmed = decoded.success.message?.trim()
  const message = trimmed ? trimmed : undefined
  return {
    ok: true as const,
    wake: decoded.success.wake,
    state,
    ...(decoded.success.wake && message !== undefined ? { message } : {}),
  }
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
  if (Result.isFailure(scannedExit)) return { ok: false as const, error: scannedExit.failure } satisfies Outcome
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
