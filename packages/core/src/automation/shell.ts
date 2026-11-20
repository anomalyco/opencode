export * as AutomationShell from "./shell.js"

import type { Automation } from "@opencode/schema/automation"
import { Effect } from "effect"
import { Agent } from "../agent.js"
import { Permission } from "../permission.js"
import { Plugin } from "../plugin.js"
import type { SessionSchema } from "../session/schema.js"
import { Shell } from "../shell.js"
import { ShellParse } from "../shell/parse.js"
import { ShellSelect } from "../shell/select.js"
import { type Invocation, matchesAuthor } from "./author.js"

const request = Effect.fnUntraced(function* (command: string, shell: string, directory: string) {
  const parsed = yield* ShellParse.scan(command, shell, directory).pipe(Effect.mapError((error) => error.message))
  return {
    action: "shell",
    resources: parsed.commands.length ? parsed.commands.map((item) => item.resource) : [command],
  }
})

export const authorize = Effect.fnUntraced(function* (
  owner: SessionSchema.Info | undefined,
  name: string,
  trigger: Automation.Trigger,
  action: Automation.ShellAction,
  directory: string,
  invocation?: Invocation,
) {
  if (invocation) yield* Plugin.awaitActivation
  const agents = yield* Agent.Service
  const agent = yield* agents.select(owner?.agent)
  if (invocation && (!owner || !matchesAuthor(owner, agent.info, invocation)))
    return yield* Effect.fail("Create the automation with the session's current agent")
  const select = yield* ShellSelect.Service
  const permission = yield* Permission.Service
  const input = {
    ...(yield* request(action.command, yield* select.resolve({ priority: "compat" }), directory)),
    agent: agent.id,
    metadata: { automation: name, trigger, unattended: true, command: action.command },
  }
  // No save patterns: approval applies only to the command stored in this automation.
  if (owner) return yield* permission.assert({ ...input, ...(invocation ?? { sessionID: owner.id }) })
  yield* permission.assertNotDeniedWithoutSession(input).pipe(Effect.provideService(Permission.Unattended, []))
})

export const start = Effect.fnUntraced(function* (
  owner: SessionSchema.Info | undefined,
  action: Automation.ShellAction,
  directory: string,
) {
  yield* Plugin.awaitActivation
  const shell = yield* Shell.Service
  const select = yield* ShellSelect.Service
  const program = yield* select.resolve({ priority: "compat" })
  const permission = yield* Permission.Service
  const info = yield* shell.create(
    { command: action.command, cwd: directory, shell: program, metadata: owner && { sessionID: owner.id } },
    (input) =>
      Effect.gen(function* () {
        if (input.command !== action.command || input.cwd !== directory || input.shell !== program)
          return yield* Effect.fail("A shell hook changed the approved invocation")
        input.timeout = 0
        const check = yield* request(input.command, input.shell, input.cwd)
        yield* (
          owner
            ? permission.assertNotDenied({ ...check, sessionID: owner.id })
            : permission.assertNotDeniedWithoutSession(check)
        )
          // This grant is only in scope for the check of the stored command. Configured denies still win.
          .pipe(Effect.provideService(Permission.Unattended, [{ action: "shell", resource: "*", effect: "allow" }]))
      }),
  )
  return shell.result(info).pipe(Effect.onInterrupt(() => shell.stop(info.id, "killed").pipe(Effect.ignore)))
})
