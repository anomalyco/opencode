export * as AutomationCode from "./code.js"

import { CodeMode } from "@opencode/codemode"
import type { Automation as AutomationSchema } from "@opencode/schema/automation"
import { Array, Effect, Option, Result, Schema } from "effect"
import { Agent } from "../agent.js"
import { CodeModeTool } from "../codemode/tool.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin.js"
import type { SessionMessage } from "../session/message.js"
import type { SessionSchema } from "../session/schema.js"
import { Tool } from "../tool.js"
import { McpTool } from "../tool/mcp.js"

export const TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 32 * 1024
const CODE_LIMITS: CodeMode.ExecutionLimits = {
  timeoutMs: TIMEOUT_MS,
  maxToolCalls: 20,
  maxOutputBytes: MAX_OUTPUT_BYTES,
}

/** Tools that would let an automation rewrite automations, or move and rename the Session that authorized it. */
const FORBIDDEN_TOOLS = new Set([
  // Approving the shell tool unattended would approve every command, not a particular command.
  "shell",
  "opencode.automation_create",
  "opencode.automation_pause",
  "opencode.automation_resume",
  "opencode.automation_delete",
  "opencode.session_move",
  "opencode.session_rename",
  "opencode.worktree_create",
  "opencode.worktree_remove",
])

const decodeReturn = Schema.decodeUnknownResult(
  Schema.NullOr(
    Schema.Struct({
      state: Schema.optionalKey(Schema.Json),
      done: Schema.optionalKey(Schema.Boolean),
    }),
  ),
)

export interface RunInput {
  readonly messageID: SessionMessage.ID
  readonly state: Schema.Json
  readonly now: number
  readonly runs: number
}

export type Outcome =
  | {
      readonly ok: true
      /** Absent when the program returned no state, so the previous state stands. */
      readonly state?: Schema.Json
      readonly done: boolean
      readonly output?: string
    }
  | {
      readonly ok: false
      readonly error: string
      readonly output?: string
      /** The program cannot succeed on a retry, e.g. a parse error or an unknown tool. */
      readonly invalid?: boolean
    }

/** Validates the program synchronously before asking for permissions. */
export function validate(code: string): Result.Result<void, string> {
  const scanned = CodeMode.scanTools(code)
  if (Result.isFailure(scanned)) return Result.fail(scanned.failure.message)
  const forbidden = scanned.success.find((path) => FORBIDDEN_TOOLS.has(path))
  if (forbidden !== undefined) return Result.fail(`Tool ${forbidden} cannot be used inside an automation`)
  return Result.succeed(undefined)
}

/**
 * Runs in the creating Session's Location while the user is present: asks once for `execute` and each tool's
 * permission, without saving, so every run can be allowed unattended.
 */
export const authorize = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  name: string,
  trigger: AutomationSchema.Trigger,
  action: AutomationSchema.CodeAction,
) {
  yield* Plugin.awaitActivation
  const permission = yield* Permission.Service
  const agents = yield* Agent.Service
  const agent = yield* agents.select(session.agent)
  const scanned = CodeMode.scanTools(action.code)
  if (Result.isFailure(scanned)) return yield* Effect.fail(scanned.failure.message)
  const paths = scanned.success
  const actions = ["execute", ...(yield* resolveTools(paths)).actions]

  // Fail fast on any explicit deny before asking the user to approve earlier tools.
  yield* Effect.forEach(
    actions,
    (item) => permission.assertNotDenied({ action: item, resources: ["*"], sessionID: session.id, agent: agent.id }),
    { discard: true },
  )
  yield* Effect.forEach(
    actions,
    (item) =>
      permission.assert({
        action: item,
        resources: ["*"],
        // No `save`: "always" would save a project-wide allow, while runs are allowed through Unattended.
        metadata: { automation: name, trigger, unattended: true, code: action.code, tools: [...paths] },
        sessionID: session.id,
        agent: agent.id,
      }),
    { discard: true },
  )
})

/** Runs one tick under the permissions authorized at creation and a 30s wall-clock cap. Never fails. */
export const run = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  action: AutomationSchema.CodeAction,
  input: RunInput,
) {
  const tick = Effect.gen(function* () {
    yield* Plugin.awaitActivation
    return yield* runCode(session, action, input)
  })
  return yield* tick.pipe(
    Effect.timeoutOption(TIMEOUT_MS),
    Effect.map(
      (result): Outcome =>
        Option.match(result, {
          onNone: () => ({ ok: false, error: `Timed out after ${TIMEOUT_MS}ms` }),
          onSome: (outcome) => outcome,
        }),
    ),
  )
})

const resolveTools = Effect.fnUntraced(function* (paths: ReadonlyArray<string>) {
  const mcp = yield* McpTool.Service
  const tools = yield* Tool.Service
  if (paths.length > 0) yield* mcp.flush
  const registered = yield* tools.list()
  const resolved: Array<(typeof registered)[number]> = []
  for (const path of paths) {
    if (FORBIDDEN_TOOLS.has(path)) return yield* Effect.fail(`Tool ${path} cannot be used inside an automation`)
    const found = registered.find(
      (item) => item.options?.codemode !== false && CodeModeTool.qualifiedName(item) === path,
    )
    if (!found) return yield* Effect.fail(`Unknown Code Mode tool: ${path}`)
    resolved.push(found)
  }
  return { tools, actions: Array.dedupe(resolved.map((tool) => tool.options?.permission ?? tool.id)) }
})

const runCode = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  action: AutomationSchema.CodeAction,
  input: RunInput,
) {
  const permission = yield* Permission.Service
  const agents = yield* Agent.Service
  const agent = yield* agents.select(session.agent)
  if (!agent.info) return { ok: false as const, error: `Agent not found: ${agent.id}` }

  const scanned = CodeMode.scanTools(action.code)
  if (Result.isFailure(scanned)) return { ok: false as const, error: scanned.failure.message, invalid: true }
  const paths = scanned.success

  const resolved = yield* Effect.result(resolveTools(paths))
  if (Result.isFailure(resolved)) return { ok: false as const, error: resolved.failure, invalid: true }

  const actions = ["execute", ...resolved.success.actions]
  const unattended: Permission.Ruleset = actions.map((item) => ({ action: item, resource: "*", effect: "allow" }))

  // A deny added to config after creation still wins.
  const notDenied = yield* Effect.forEach(
    actions,
    (item) => permission.assertNotDenied({ action: item, resources: ["*"], sessionID: session.id, agent: agent.id }),
    { discard: true },
  ).pipe(Effect.provideService(Permission.Unattended, unattended), Effect.result)
  if (Result.isFailure(notDenied)) return { ok: false as const, error: notDenied.failure.message }

  const args = action.args ?? null
  const result = yield* resolved.success.tools
    .check({
      code: action.code,
      tools: paths,
      bindings: {
        state: input.state,
        now: input.now,
        runs: input.runs,
        args,
        input: { state: input.state, now: input.now, runs: input.runs, args },
      },
      permissions: Permission.merge(agent.info.permissions, session.permissions ?? []),
      limits: CODE_LIMITS,
      context: {
        sessionID: session.id,
        agent: agent.id,
        messageID: input.messageID,
        progress: () => Effect.void,
      },
    })
    .pipe(Effect.provideService(Permission.Unattended, unattended))

  const output = result.logs?.length ? result.logs.join("\n") : undefined
  if (!result.ok) {
    const invalid =
      result.error.kind === "ParseError" ||
      result.error.kind === "UnsupportedSyntax" ||
      result.error.kind === "UnknownTool" ||
      result.error.kind === "InvalidToolInput" ||
      result.error.message.includes("needs approval")
    return { ok: false as const, error: result.error.message, output, ...(invalid ? { invalid: true } : {}) }
  }
  const decoded = decodeReturn(result.value)
  if (Result.isFailure(decoded)) {
    return {
      ok: false as const,
      error: `An automation must return nothing or { state?, done? }: ${decoded.failure}`,
      output,
      invalid: true,
    }
  }
  return {
    ok: true as const,
    ...(decoded.success?.state === undefined ? {} : { state: decoded.success.state }),
    done: decoded.success?.done === true,
    output,
  }
})
