import { commandAcceptsValue, isCommandName } from "./commands.js"
import type { DriveCommand } from "./types.js"

export function extractCommands(args: ReadonlyArray<string>) {
  const commands: DriveCommand[] = []
  const remaining: string[] = []
  const separator = args.indexOf("--")
  const cli = separator === -1 ? args : args.slice(0, separator)
  const app = separator === -1 ? [] : args.slice(separator + 1)

  for (let index = 0; index < cli.length; index++) {
    const flag = cli[index]!
    if (!flag.startsWith("--command.")) {
      remaining.push(flag)
      continue
    }
    const operation = flag.slice("--command.".length)
    if (!isCommandName(operation))
      throw new Error(`unknown drive command "${operation}"`)
    const valueMode = commandAcceptsValue(operation)
    const next = cli[index + 1]
    const takesValue = valueMode === true || (valueMode === "optional" && next !== undefined && !next.startsWith("--"))
    const value = takesValue ? cli[++index] : undefined
    if (valueMode === true && (value === undefined || value.startsWith("--"))) throw new Error(`${flag} requires a value`)
    commands.push({ operation, ...(value === undefined ? {} : { value }) })
  }
  return { args: remaining, app, commands }
}
