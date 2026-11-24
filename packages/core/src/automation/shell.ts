export * as AutomationShell from "./shell.js"

import type { Automation } from "@opencode/schema/automation"
import { Effect } from "effect"
import { Agent } from "../agent.js"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin/service.js"
import type { SessionSchema } from "../session/schema.js"
import { Shell } from "../shell.js"
import { ShellPermissions } from "../shell/permissions.js"
import { ShellSelect } from "../shell/select.js"
import { type Invocation, matchesAuthor } from "./author.js"

export const authorize = Effect.fnUntraced(function* (
  owner: SessionSchema.Info,
  name: string,
  trigger: Automation.Trigger,
  action: Automation.ShellAction,
  invocation?: Invocation,
) {
  if (invocation) yield* Plugin.awaitActivation
  const agents = yield* Agent.Service
  const agent = yield* agents.select(owner.agent)
  if (invocation && !matchesAuthor(owner, agent.info, invocation))
    return yield* Effect.fail("Create the automation with the session's current agent")
  const select = yield* ShellSelect.Service
  const environment = yield* Environment.Service
  const access = yield* FileAccess.Service
  const permission = yield* Permission.Service
  const program = yield* select.resolve({ priority: "compat" })
  const target = yield* access
    .resolve({
      path: ".",
      base: { absolute: owner.location.directory, environment },
      kind: "directory",
    })
    .pipe(Effect.mapError((error) => error.message))
  const requests = yield* ShellPermissions.requests(access, {
    command: action.command,
    program,
    target,
    once: true,
    policy: Effect.succeed(Permission.Policy.fromRules(agent.info?.permissions ?? [], owner.permissions ?? [])),
  }).pipe(Effect.mapError((error) => error.message))
  // No save patterns: approval applies only to the command stored in this automation.
  yield* Effect.forEach(
    requests,
    (request) =>
      permission.assert({
        ...request,
        ...(invocation ?? { sessionID: owner.id, agent: agent.id }),
        metadata: { automation: name, trigger, unattended: true, command: action.command },
      }),
    { discard: true },
  )
})

// Approved once at creation (see authorize); runs intentionally don't recheck permissions. Pause or delete to stop future runs.
export const start = Effect.fnUntraced(function* (
  owner: SessionSchema.Info,
  action: Automation.ShellAction,
  directory: string,
) {
  yield* Plugin.awaitActivation
  const shell = yield* Shell.Service
  const select = yield* ShellSelect.Service
  const program = yield* select.resolve({ priority: "compat" })
  const info = yield* shell.create(
    { command: action.command, cwd: directory, shell: program, metadata: { sessionID: owner.id } },
    (input) =>
      Effect.sync(() => {
        // Hooks can set the environment, but the stored command and its working directory are fixed.
        input.command = action.command
        input.cwd = directory
        input.shell = program
        input.timeout = 0
      }),
  )
  return shell.result(info).pipe(Effect.onInterrupt(() => shell.stop(info.id, "killed").pipe(Effect.ignore)))
})
