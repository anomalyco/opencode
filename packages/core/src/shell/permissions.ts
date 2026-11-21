export * as ShellPermissions from "./permissions.js"

import { Effect } from "effect"
import { FileAccess } from "../file-access.js"
import { ShellParse } from "./parse.js"

export const requests = Effect.fnUntraced(function* (
  access: FileAccess.Interface,
  input: {
    readonly command: string
    readonly program: string
    readonly target: FileAccess.Target
    readonly local: boolean
    readonly once?: boolean
  },
) {
  const parsed = yield* ShellParse.scan(input.command, input.program, input.target.absolute, {
    home: input.local ? undefined : null,
  })
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
