export * as ScheduleAction from "./action.js"

import type { Schedule as ScheduleSchema } from "@opencode/schema/schedule"
import { Effect, Option, Result, type Schema } from "effect"
import { Agent } from "../agent.js"
import { Command } from "../command.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin.js"
import type { SessionMessage } from "../session/message.js"
import type { SessionSchema } from "../session/schema.js"
import { ScheduleCheck } from "./check.js"

const DEFAULT_SUBAGENT = Agent.ID.make("general")

export function validate(action: ScheduleSchema.Action): Result.Result<void, string> {
  switch (action.type) {
    case "prompt":
      if (action.prompt.trim() === "") return Result.fail("A prompt action needs a prompt")
      if ((action.thread ?? "same") === "same" && (action.deliver === "silent" || action.deliver === "inbox"))
        return Result.fail(
          `deliver: "${action.deliver}" requires a background action (subagent, dedicated, command, run or code)`,
        )
      return Result.succeed(undefined)
    case "subagent":
      if (action.prompt.trim() === "") return Result.fail("A subagent action needs a prompt")
      if (action.agent !== undefined && action.agent.trim() === "") return Result.fail("Agent name cannot be empty")
      return Result.succeed(undefined)
    case "command":
      if (action.command.trim() === "") return Result.fail("A command action needs a command name")
      if (action.command === "schedule") return Result.fail("Command schedule cannot be scheduled")
      if (action.target === "same" && (action.deliver === "silent" || action.deliver === "inbox"))
        return Result.fail(`deliver: "${action.deliver}" cannot be combined with target: "same"`)
      return Result.succeed(undefined)
    case "shell":
      return action.run.trim() === "" ? Result.fail("A shell action needs a command") : Result.succeed(undefined)
    case "code":
      return ScheduleCheck.validateCode(action.code, "schedule action")
  }
}

export function defaultLabel(action: ScheduleSchema.Action): string {
  switch (action.type) {
    case "prompt":
      return action.thread === "dedicated" ? "Scheduled thread" : "Scheduled prompt"
    case "subagent":
      return "Scheduled subagent"
    case "command":
      return `/${action.command}`
    case "shell":
      return "Scheduled command"
    case "code":
      return "Scheduled script"
  }
}

export function summaryText(action: ScheduleSchema.Action): string {
  switch (action.type) {
    case "prompt":
    case "subagent":
      return action.prompt
    case "command":
      return action.arguments?.trim() ? `/${action.command} ${action.arguments.trim()}` : `/${action.command}`
    case "shell":
      return action.run
    case "code":
      return action.code
  }
}

export function isBackground(action: ScheduleSchema.Action): boolean {
  switch (action.type) {
    case "prompt":
      return action.thread === "dedicated"
    case "command":
      return (action.target ?? "subagent") !== "same"
    case "subagent":
    case "shell":
    case "code":
      return true
  }
}

export function usesDedicatedSession(action: ScheduleSchema.Action): boolean {
  return (
    (action.type === "prompt" && action.thread === "dedicated") ||
    (action.type === "command" && action.target === "dedicated")
  )
}

export function deliverMode(action: ScheduleSchema.Action): ScheduleSchema.Delivery {
  return action.deliver ?? "session"
}

export function isQuietOutput(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === "" || /^NO_REPLY[.!]*$/i.test(trimmed)
}

/** Resolves the target agent and model for a background `subagent`, `command`, or `dedicated` action. */
export const selectSubagent = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  requestedAgent: string | undefined,
  commandName?: string,
) {
  const plugins = yield* Plugin.Service
  yield* plugins.awaitActivation
  const agents = yield* Agent.Service
  if (commandName !== undefined) {
    const commands = yield* Command.Service
    const found = yield* commands.definition(commandName)
    if (found?.agent !== undefined) {
      const resolved = yield* agents.resolve(found.agent)
      if (resolved) return { id: resolved.id, model: resolved.model ?? session.model }
    }
  }
  if (requestedAgent !== undefined) {
    const resolved = yield* agents.resolve(requestedAgent)
    if (!resolved) return yield* Effect.fail(new Error(`Unknown agent: ${requestedAgent}`))
    if (resolved.mode === "primary")
      return yield* Effect.fail(new Error(`Agent ${requestedAgent} cannot run as a subagent`))
    return { id: resolved.id, model: resolved.model ?? session.model }
  }
  const general = yield* agents.resolve(DEFAULT_SUBAGENT)
  if (general) return { id: general.id, model: general.model ?? session.model }
  const fallback = yield* agents.select(session.agent)
  return { id: fallback.id, model: fallback.info?.model ?? session.model }
})

/** Validates and authorizes action permissions at `Schedule.create` time while the user is present. */
export const authorize = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  name: string | undefined,
  when: ScheduleSchema.When,
  action: ScheduleSchema.Action,
) {
  if (action.type === "prompt" && action.thread !== "dedicated") return
  const plugins = yield* Plugin.Service
  yield* plugins.awaitActivation
  const baseMeta = { schedule: name, mode: "action", when, unattended: true }

  if (action.type === "shell") {
    yield* ScheduleCheck.authorizeShellCommand(session, action.run, { ...baseMeta, run: action.run })
    return
  }
  if (action.type === "code") {
    yield* ScheduleCheck.authorizeCodeProgram(session, action.code, baseMeta, {
      allowEdit: true,
      target: "schedule action",
    })
    return
  }

  let commandAgent: Agent.ID | undefined
  if (action.type === "command") {
    const commands = yield* Command.Service
    const found = yield* commands.definition(action.command)
    if (!found) return yield* Effect.fail(`Unknown command: ${action.command}`)
    commandAgent = found.agent
    for (const snippet of found.shell ?? []) {
      yield* ScheduleCheck.authorizeShellCommand(session, snippet, {
        ...baseMeta,
        command: action.command,
        run: snippet,
      })
    }
    if ((action.target ?? "subagent") === "same") return
  }

  const agents = yield* Agent.Service
  const permission = yield* Permission.Service
  const caller = yield* agents.select(session.agent)
  const dedicated = usesDedicatedSession(action)
  const targetAgent =
    commandAgent ??
    (dedicated
      ? caller.id
      : (
          yield* selectSubagent(session, action.type === "subagent" ? action.agent : undefined).pipe(
            Effect.mapError((error) => error.message),
          )
        ).id)

  yield* permission.assert({
    action: "subagent",
    resources: [targetAgent],
    metadata: {
      ...baseMeta,
      ...(dedicated ? { dedicated: true } : { agent: targetAgent }),
      ...(action.type === "command" ? { command: action.command } : {}),
    },
    sessionID: session.id,
    agent: caller.id,
  })
})

export const runDeterministic = Effect.fnUntraced(function* (
  session: SessionSchema.Info,
  action: ScheduleSchema.ShellAction | ScheduleSchema.CodeAction,
  context: {
    readonly messageID: SessionMessage.ID
    readonly now: number
    readonly run: number
    readonly message?: string
  },
) {
  const plugins = yield* Plugin.Service
  yield* plugins.awaitActivation
  const task = Effect.gen(function* () {
    if (action.type === "shell") {
      const executed = yield* ScheduleCheck.execShellCommand(session, action.run)
      if (Result.isFailure(executed)) return yield* Effect.fail(new Error(executed.failure))
      if (executed.success.exitCode !== 0) {
        const detail = executed.success.stderr.trim() || executed.success.stdout.trim()
        return yield* Effect.fail(
          new Error(`Command exited with code ${executed.success.exitCode}${detail ? `: ${detail}` : ""}`),
        )
      }
      return executed.success.stdout.trim()
    }
    const scope: Record<string, Schema.Json> = {
      now: context.now,
      run: context.run,
      ...(context.message === undefined ? {} : { message: context.message }),
    }
    const executed = yield* ScheduleCheck.execCodeProgram(
      session,
      action.code,
      { ...scope, input: scope },
      context.messageID,
      { allowEdit: true, target: "schedule action" },
    )
    if (!executed.ok) return yield* Effect.fail(new Error(executed.error))
    return formatCodeResult(executed.value)
  })

  const timed = yield* task.pipe(Effect.timeoutOption(ScheduleCheck.TIMEOUT_MS))
  return yield* Option.match(timed, {
    onNone: () => Effect.fail(new Error(`Scheduled action timed out after ${ScheduleCheck.TIMEOUT_MS}ms`)),
    onSome: Effect.succeed,
  })
})

export function extractTurnReply(
  messages: ReadonlyArray<SessionMessage.Info>,
  priorLatestID: SessionMessage.ID | undefined,
): Result.Result<string, string> {
  for (const message of messages) {
    if (priorLatestID !== undefined && message.id === priorLatestID) break
    if (message.type !== "assistant") continue
    if (message.error !== undefined) return Result.fail(message.error.message)
    if (message.time.completed === undefined) continue
    return Result.succeed(
      message.content
        .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : []))
        .join("\n\n"),
    )
  }
  return Result.succeed("")
}

function formatCodeResult(value: unknown): string {
  if (value === undefined || value === null || value === false) return ""
  return typeof value === "string" ? value.trim() : JSON.stringify(value, null, 2)
}
