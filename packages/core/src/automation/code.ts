export * as AutomationCode from "./code.js"

import { CodeMode } from "@opencode/codemode"
import type { Automation } from "@opencode/schema/automation"
import { Array, Effect, Option, Result, Schema } from "effect"
import { Agent } from "../agent.js"
import { CodeModeTool } from "../codemode/tool.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin.js"
import type { SessionMessage } from "../session/message.js"
import type { SessionSchema } from "../session/schema.js"
import { Tool } from "../tool.js"
import { McpTool } from "../tool/mcp.js"
import { Wildcard } from "../util/wildcard.js"

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

function scan(code: string): Result.Result<ReadonlyArray<string>, string> {
  const scanned = CodeMode.scanTools(code)
  if (Result.isFailure(scanned)) return Result.fail(scanned.failure.message)
  const forbidden = scanned.success.find((path) => FORBIDDEN_TOOLS.has(path))
  if (forbidden !== undefined) return Result.fail(`Tool ${forbidden} cannot be used inside an automation`)
  return Result.succeed(scanned.success)
}

/** Validates the program without loading a Location or asking for permissions. */
export const validate = (code: string): Result.Result<void, string> => Result.map(scan(code), () => undefined)

/**
 * Runs in the creating Session's Location while the user is present: asks once for each tool's permission (and for
 * `execute` unless a tool asked), without saving, so every run can be allowed unattended.
 */
export const authorize = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  name: string,
  trigger: Automation.Trigger,
  action: Automation.CodeAction,
) {
  const paths = yield* Effect.fromResult(scan(action.code))
  yield* Plugin.awaitActivation
  const permission = yield* Permission.Service
  const agents = yield* Agent.Service
  const agent = yield* agents.select(session.agent)
  const actions = (yield* resolveTools(paths)).actions
  const rules = Permission.merge(agent.info?.permissions ?? [], session.permissions ?? [])
  // A rule scoped to some resources (`vault:*: ask`) must prompt too, not only the catch-all `*`.
  const request = (item: string) => ({
    action: item,
    resources: Array.dedupe([
      "*",
      ...narrower(rules, item).flatMap((rule) => (rule.effect === "ask" ? [rule.resource] : [])),
    ]),
    sessionID: session.id,
    agent: agent.id,
  })
  const all = ["execute", ...actions]
  // Fail fast on any explicit deny before asking the user to approve earlier tools.
  yield* Effect.forEach(all, (item) => permission.assertNotDenied(request(item)), { discard: true })
  // A tool's approval also covers running the program; with no tool to ask about, `execute` itself must be approved.
  const allowed = yield* Effect.forEach(actions, (item) => permission.allows(request(item)))
  yield* Effect.forEach(
    allowed.every(Boolean) ? all : actions,
    (item) =>
      permission.assert({
        ...request(item),
        // No `save`: "always" would save a project-wide allow, while runs are allowed through Unattended.
        metadata: { automation: name, trigger, unattended: true, code: action.code, tools: [...paths] },
      }),
    { discard: true },
  )
})

/** Rules for `action` that name specific resources rather than `*`, in order. */
function narrower(rules: Permission.Ruleset, action: string) {
  return rules.filter((rule) => rule.resource !== "*" && Wildcard.match(action, rule.action))
}

const resolveTools = Effect.fnUntraced(function* (paths: ReadonlyArray<string>) {
  const mcp = yield* McpTool.Service
  const tools = yield* Tool.Service
  if (paths.length === 0) return { tools, actions: [] }
  yield* mcp.flush
  const registered = yield* tools.list()
  const actions = new Set<string>()
  for (const path of paths) {
    const found = registered.find(
      (item) => item.options?.codemode !== false && CodeModeTool.qualifiedName(item) === path,
    )
    if (!found) return yield* Effect.fail(`Unknown Code Mode tool: ${path}`)
    actions.add(found.options?.permission ?? found.id)
  }
  return { tools, actions: [...actions] }
})

/** Runs one tick under the permissions authorized at creation, including plugin activation in the wall-clock cap. */
export const run = Effect.fnUntraced(
  function* (session: SessionSchema.Info, action: Automation.CodeAction, input: RunInput) {
    yield* Plugin.awaitActivation
    const permission = yield* Permission.Service
    const agents = yield* Agent.Service
    const agent = yield* agents.select(session.agent)
    if (!agent.info) return { ok: false as const, error: `Agent not found: ${agent.id}` }

    const scanned = scan(action.code)
    if (Result.isFailure(scanned)) return { ok: false as const, error: scanned.failure, invalid: true }
    const paths = scanned.success

    const resolved = yield* Effect.result(resolveTools(paths))
    if (Result.isFailure(resolved)) return { ok: false as const, error: resolved.failure, invalid: true }

    const actions = ["execute", ...resolved.success.actions]
    const rules = Permission.merge(agent.info.permissions, session.permissions ?? [])
    // Unattended rules come after the configured ones and the last match wins, so restate every narrower rule after the
    // grant: the approval stands in for the catch-all `*` only, and a scoped `ask` still needs a person.
    const unattended: Permission.Ruleset = actions.flatMap((item) => [
      { action: item, resource: "*", effect: "allow" as const },
      ...narrower(rules, item),
    ])

    // A deny added to config after creation still wins.
    const notDenied = yield* Effect.forEach(
      actions,
      (item) => permission.assertNotDenied({ action: item, resources: ["*"], sessionID: session.id, agent: agent.id }),
      { discard: true },
    ).pipe(Effect.provideService(Permission.Unattended, unattended), Effect.result)
    if (Result.isFailure(notDenied)) return { ok: false as const, error: notDenied.failure.message }

    const bindings = { state: input.state, now: input.now, runs: input.runs, args: action.args ?? null }
    const result = yield* resolved.success.tools
      .check({
        code: action.code,
        tools: paths,
        bindings: { ...bindings, input: bindings },
        permissions: rules,
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
  },
  Effect.timeoutOption(TIMEOUT_MS),
  Effect.map(
    (result): Outcome =>
      Option.isSome(result) ? result.value : { ok: false, error: `Timed out after ${TIMEOUT_MS}ms` },
  ),
)
