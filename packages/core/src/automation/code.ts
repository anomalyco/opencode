export * as AutomationCode from "./code.js"

import { CodeMode } from "@opencode/codemode"
import { Automation } from "@opencode/schema/automation"
import { Array, Effect, Option, Result, Schema } from "effect"
import { Agent } from "../agent.js"
import { CodeModeTool } from "../codemode/tool.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin/service.js"
import type { SessionMessage } from "../session/message.js"
import type { SessionSchema } from "../session/schema.js"
import { Tool } from "../tool.js"
import { McpTool } from "../tool/mcp.js"

import { type Invocation, matchesAuthor } from "./author.js"
import type { AutomationEvent } from "./event.js"

export const TIMEOUT_MS = 30_000
const MAX_OUTPUT_BYTES = 32 * 1024
const CODE_LIMITS: CodeMode.ExecutionLimits = {
  timeoutMs: TIMEOUT_MS,
  maxOutputBytes: MAX_OUTPUT_BYTES,
}

export function boundedOutput(text: string) {
  if (Buffer.byteLength(text) <= MAX_OUTPUT_BYTES) return text
  const { read } = new TextEncoder().encodeInto(text, new Uint8Array(MAX_OUTPUT_BYTES - Buffer.byteLength("…")))
  return text.slice(0, read) + "…"
}

/** Keep the delivery visible first, including when the logs use the entire byte budget. */
export function handoffOutput(delivery: string, logs?: string) {
  return boundedOutput(logs === undefined ? delivery : `${delivery}\n${logs}`)
}

/** Tools that must not receive an unattended grant from an automation. */
const FORBIDDEN_TOOLS = new Set([
  "automation.create",
  "automation.pause",
  "automation.resume",
  "automation.delete",
  "opencode.session.move",
])

export interface RunInput {
  readonly automationID: Automation.ID
  readonly messageID: SessionMessage.ID
  readonly state: Schema.Json
  readonly now: number
  readonly runs: number
  readonly event?: ReturnType<typeof AutomationEvent.input>
}

export type Outcome =
  | (Automation.CodeResult & { readonly ok: true; readonly output?: string })
  | {
      readonly ok: false
      readonly error: string
      readonly output?: string
      /** A tool the program names is missing from the catalog right now, so the run is skipped. */
      readonly unavailable?: boolean
    }

type ProgramScan = { readonly tools: ReadonlyArray<string>; readonly actions: ReadonlySet<string> }

// Script text is immutable. Only cache the static scan, never tool registrations or permission decisions.
const scans = new Map<string, Result.Result<ProgramScan, string>>()

function scan(code: string) {
  const cached = scans.get(code)
  if (cached) return cached
  const scanned = scanProgram(code)
  if (scans.size === 16) for (const oldest of scans.keys().take(1)) scans.delete(oldest)
  scans.set(code, scanned)
  return scanned
}

function scanProgram(code: string): Result.Result<ProgramScan, string> {
  const scanned = CodeMode.scanProgram(code, ["fetch", "Bun"], ["slice"])
  if (Result.isFailure(scanned)) return Result.fail(scanned.failure.message)
  const forbidden = scanned.success.tools.find((path) => FORBIDDEN_TOOLS.has(path))
  if (forbidden !== undefined) return Result.fail(`Tool ${forbidden} cannot be used inside an automation`)
  return Result.succeed({ tools: scanned.success.tools, actions: extensionActions(scanned.success) })
}

/**
 * Runs in the creating Session's Location while the user is present: asks once for tool and extension permissions (and for
 * `execute` if none of those needed approval), without saving, so every run can be allowed unattended.
 */
export const authorize = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  name: string,
  trigger: Automation.Trigger,
  action: Automation.CodeAction,
  invocation?: Invocation,
) {
  const scanned = yield* Effect.fromResult(scan(action.code))
  yield* Plugin.awaitActivation
  const permission = yield* Permission.Service
  const agents = yield* Agent.Service
  const agent = yield* agents.select(session.agent)
  if (invocation && !matchesAuthor(session, agent.info, invocation))
    return yield* Effect.fail("Create the automation with the session's current agent")
  const actions = (yield* resolveCapabilities(scanned).pipe(
    Effect.mapError(({ path }) => `Unknown Code Mode tool: ${path}`),
  )).actions
  const policy = Permission.Policy.fromRules(agent.info?.permissions ?? [], session.permissions ?? [])
  // A rule scoped to some resources (`vault:*: ask`) must prompt too, not only the catch-all `*`.
  const request = (item: string) => ({
    action: item,
    resources: Array.dedupe([
      "*",
      ...Permission.Policy.scopedRules(policy, item).flatMap((rule) => (rule.effect === "ask" ? [rule.resource] : [])),
    ]),
    ...(invocation ?? { sessionID: session.id, agent: agent.id }),
  })
  const all = ["execute", ...actions]
  // Fail fast on any explicit deny before asking the user to approve earlier tools.
  yield* Effect.forEach(all, (item) => permission.assertNotDenied(request(item)), { discard: true })
  // A capability's approval also covers running the program; otherwise ask to run `execute` itself.
  const allowed = yield* Effect.forEach(actions, (item) => permission.allows(request(item)))
  yield* Effect.forEach(
    allowed.every(Boolean) ? all : actions,
    (item) =>
      permission.assert({
        ...request(item),
        // No `save`: "always" would save a project-wide allow, while runs are allowed through Unattended.
        metadata: { automation: name, trigger, unattended: true, code: action.code, tools: [...scanned.tools] },
      }),
    { discard: true },
  )
})

const bunFileReadMembers = new Set([
  "name",
  "type",
  "size",
  "lastModified",
  "text",
  "json",
  "bytes",
  "arrayBuffer",
  "exists",
  "stat",
])

const resolveCapabilities = Effect.fnUntraced(function* (scanned: ProgramScan) {
  const tools = yield* Tool.Service
  const actions = new Set<string>()
  if (scanned.tools.length > 0) {
    const mcp = yield* McpTool.Service
    yield* mcp.flush
    const selected = yield* tools.codeModeTools(scanned.tools)
    for (const path of scanned.tools) {
      const tool = selected.get(path)
      if (!tool) return yield* Effect.fail({ path })
      actions.add(tool.options?.permission ?? tool.id)
    }
  }
  for (const action of scanned.actions) actions.add(action)
  return { tools, actions: [...actions] }
})

function extensionActions(scanned: Result.Result.Success<ReturnType<typeof CodeMode.scanProgram>>) {
  const actions = new Set<string>()
  if (scanned.globals.has("fetch")) actions.add("webfetch")
  // Approve referenced file access even if the flag is off, so enabling it later doesn't grant it unattended.
  const bun = scanned.globals.get("Bun") ?? []
  if (scanned.modules.has("bun") || bun.some((use) => use.member === undefined)) {
    actions.add("read")
    actions.add("edit")
    actions.add("external_directory")
  }
  for (const use of bun) {
    if (use.member === "file" || use.member === "Glob") actions.add("read")
    if (
      use.member === "write" ||
      (use.member === "file" &&
        Iterator.from(use.resultMembers).some((member) => !bunFileReadMembers.has(member ?? "")))
    )
      actions.add("edit")
    if (use.member === "file" || use.member === "Glob" || use.member === "write") actions.add("external_directory")
  }
  return actions
}

/** Runs the program once under the permissions authorized at creation. Plugin activation counts toward the time cap. */
export const run = Effect.fnUntraced(
  function* (session: SessionSchema.Info, action: Automation.CodeAction, input: RunInput) {
    yield* Plugin.awaitActivation
    const permission = yield* Permission.Service
    const agents = yield* Agent.Service
    const agent = yield* agents.select(session.agent)
    if (!agent.info) return { ok: false as const, error: `Agent not found: ${agent.id}` }

    const scanned = scan(action.code)
    if (Result.isFailure(scanned)) return { ok: false as const, error: scanned.failure }

    const resolved = yield* Effect.result(resolveCapabilities(scanned.success))
    if (Result.isFailure(resolved))
      return { ok: false as const, error: `${resolved.failure.path} unavailable`, unavailable: true }

    const actions = ["execute", ...resolved.success.actions]
    const policy = Permission.Policy.fromRules(agent.info.permissions, session.permissions ?? [])
    // Unattended rules come after the configured ones and the last match wins, so restate every scoped rule after the
    // grant: the approval stands in for the catch-all `*` only, and a scoped `ask` still needs a person.
    const unattended: Permission.Ruleset = actions.flatMap((item) => [
      { action: item, resource: "*", effect: "allow" as const },
      ...Permission.Policy.scopedRules(policy, item),
    ])

    // A deny added to config after creation still wins.
    const notDenied = yield* Effect.forEach(
      actions,
      (item) => permission.assertNotDenied({ action: item, resources: ["*"], sessionID: session.id, agent: agent.id }),
      { discard: true },
    ).pipe(Effect.provideService(Permission.Unattended, unattended), Effect.result)
    if (Result.isFailure(notDenied)) return { ok: false as const, error: notDenied.failure.message }

    const bindings = {
      state: input.state,
      now: input.now,
      runs: input.runs,
      args: action.args ?? null,
      ...(input.event && { event: input.event }),
    }
    const result = yield* resolved.success.tools
      .check({
        code: action.code,
        tools: scanned.success.tools,
        bindings: { ...bindings, input: bindings },
        policy,
        limits: CODE_LIMITS,
        services: yield* CodeModeTool.services,
        context: {
          sessionID: session.id,
          agent: agent.id,
          messageID: input.messageID,
          progress: () => Effect.void,
          automation: { id: input.automationID },
        },
      })
      .pipe(Effect.provideService(Permission.Unattended, unattended))

    const output = result.logs?.length ? boundedOutput(result.logs.join("\n")) : undefined
    if (!result.ok) return { ok: false as const, error: result.error.message, output }
    const decoded = Automation.decodeCodeResult(result.value)
    if (Result.isFailure(decoded)) {
      return {
        ok: false as const,
        error: `An automation must return nothing or { state?, done?, send? }: ${decoded.failure}`,
        output,
      }
    }
    return { ok: true as const, ...decoded.success, output }
  },
  Effect.timeoutOption(TIMEOUT_MS),
  Effect.map(
    (result): Outcome =>
      Option.isSome(result) ? result.value : { ok: false, error: `Timed out after ${TIMEOUT_MS}ms` },
  ),
)
