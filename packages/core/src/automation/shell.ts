export * as AutomationShell from "./shell.js"

import type { Automation } from "@opencode/schema/automation"
import { Effect } from "effect"
import { Agent } from "../agent.js"
import { Config } from "../config.js"
import { Environment } from "../environment/index.js"
import { FileAccess } from "../file-access.js"
import { ManagedPolicy } from "../managed-policy.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin/service.js"
import { AbsolutePath } from "../schema.js"
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
  const permission = yield* Permission.Service
  // No save patterns: approval applies only to the command stored in this automation.
  yield* Effect.forEach(
    yield* requests(
      action,
      owner.location.directory,
      Permission.Policy.fromRules(agent.info?.permissions ?? [], owner.permissions ?? []),
    ).pipe(Effect.mapError((error) => error.message)),
    (request) =>
      permission.assert({
        ...request,
        ...(invocation ?? { sessionID: owner.id, agent: agent.id }),
        metadata: {
          ...("metadata" in request ? request.metadata : {}),
          automation: name,
          trigger,
          unattended: true,
          command: action.command,
        },
      }),
    { discard: true },
  )
})

// Approved once at creation (see authorize); runs intentionally don't recheck agent or session permissions. Managed
// policy can change after creation, so each run rechecks its `tool.use` and `tool.auto` denies: a run can't ask, so a
// command policy now blocks or requires a fresh approval for doesn't start. Pause or delete to stop future runs.
export const start = Effect.fnUntraced(function* (
  owner: SessionSchema.Info,
  action: Automation.ShellAction,
  directory: string,
) {
  yield* Plugin.awaitActivation
  const shell = yield* Shell.Service
  const select = yield* ShellSelect.Service
  const config = yield* Config.Service
  const statements = ManagedPolicy.statements(yield* config.entries())
  // Scan the command only when a policy could stop it.
  if (
    statements.some(
      (policy) => (policy.action === "tool.use" || policy.action === "tool.auto") && policy.effect === "deny",
    )
  )
    for (const request of yield* requests(action, AbsolutePath.make(directory), Permission.Policy.fromRules())) {
      const denied =
        ManagedPolicy.denying(statements, "tool.use", request) ??
        ManagedPolicy.denying(statements, "tool.auto", request)
      if (denied)
        return yield* new Permission.BlockedError({
          rules: [],
          permission: request.action,
          resources: request.resources,
          reason: denied.message,
        })
    }
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

const requests = Effect.fnUntraced(function* (
  action: Automation.ShellAction,
  directory: AbsolutePath,
  policy: Permission.Policy.Policy,
) {
  const select = yield* ShellSelect.Service
  const environment = yield* Environment.Service
  const access = yield* FileAccess.Service
  const program = yield* select.resolve({ priority: "compat" })
  const target = yield* access.resolve({ path: ".", base: { absolute: directory, environment }, kind: "directory" })
  return yield* ShellPermissions.requests(access, {
    command: action.command,
    program,
    target,
    once: true,
    policy: Effect.succeed(policy),
  })
})
