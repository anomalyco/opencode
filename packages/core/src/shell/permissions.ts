export * as ShellPermissions from "./permissions.js"

import { Effect, Result, Schema } from "effect"
import { FileAccess } from "../file-access.js"
import type { Permission } from "../permission.js"
import { Wildcard } from "../util/wildcard.js"
import { ShellParse } from "./parse.js"

export class UnverifiableError extends Schema.TaggedError<UnverifiableError>()("ShellPermissions.UnverifiableError", {
  reason: Schema.String,
}) {
  override get message() {
    return `Portable shell scanner cannot analyze command: ${this.reason}. A shell deny rule is configured and the command cannot be checked against it; rewrite it without eval or other dynamic execution.`
  }
}

export const requests = Effect.fnUntraced(function* <E>(
  access: FileAccess.Interface,
  input: {
    readonly command: string
    readonly program: string
    readonly target: FileAccess.Target
    readonly once?: boolean
    /** The agent's and session's rules, read only for a command the scanner can't analyze. */
    readonly rules: Effect.Effect<Permission.Ruleset, E>
  },
) {
  const scanned = yield* Effect.result(
    ShellParse.scan(input.command, input.program, input.target.absolute, {
      home: input.target.machine === undefined ? undefined : null,
    }),
  )
  if (Result.isFailure(scanned)) {
    // A deny pattern can't be matched against subcommands the scanner couldn't find.
    if ((yield* input.rules).some((rule) => rule.effect === "deny" && Wildcard.match("shell", rule.action)))
      return yield* new UnverifiableError({ reason: scanned.failure.reason })
    // An unanalyzed command may reach any directory, so only rules allowing every directory settle it, and approval
    // is never saved as a pattern.
    return [
      { action: "external_directory", resources: ["*"], save: undefined },
      { action: "shell", resources: [input.command], save: undefined, metadata: { reason: scanned.failure.reason } },
    ]
  }
  const parsed = scanned.success
  // Directory arguments are relative to the command's working directory on the same machine.
  const directories = yield* Effect.forEach(parsed.directories, (directory) =>
    access.resolve({ path: directory, base: input.target, kind: "directory" }),
  )
  const external = FileAccess.externalDirectoryRequest([input.target, ...directories])
  const command =
    parsed.commands.length > 0 || input.once
      ? {
          action: "shell",
          resources: parsed.commands.length > 0 ? parsed.commands.map((command) => command.resource) : [input.command],
          save: parsed.commands.map((command) => command.save),
        }
      : undefined
  return [external, command].flatMap((request) =>
    request ? [{ ...request, save: input.once ? undefined : request.save }] : [],
  )
})
