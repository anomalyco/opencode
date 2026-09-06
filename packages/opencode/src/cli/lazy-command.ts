import type { CommandModule } from "yargs"
import type { Argv } from "yargs"

/**
 * Lazy command registration for the CLI entrypoint.
 *
 * The full CLI statically imports every command module, which pulls in heavy
 * dependencies (server, session, sdk, config schemas) and costs tens of
 * seconds at startup — even for cheap invocations like `--version`. Register
 * each command as a delegating module that only loads the real implementation
 * when yargs parses an invocation that exercises it. `builder` and `handler`
 * run lazily; `command`/`describe`/`aliases` stay eager so help text works.
 */
export const lazyCommand = <T, U>(
  input: {
    readonly command: string
    readonly aliases?: readonly string[]
    readonly describe?: string | false
    readonly load: () => Promise<Record<string, unknown>>
    readonly resolve: (mod: Record<string, unknown>) => CommandModule<T, U>
  },
): CommandModule<T, U> => {
  const command = input.command
  const aliases = input.aliases
  const describe = input.describe
  const handle = async (args: unknown) => {
    const mod = await input.load()
    return input.resolve(mod).handler?.(args as U)
  }
  const build = async (args: Argv<T>) => {
    const mod = await input.load()
    const builder = input.resolve(mod).builder as unknown
    if (typeof builder === "function") return builder(args)
    return args
  }
  return {
    command,
    aliases,
    describe,
    builder: build as never,
    handler: handle as never,
  }
}
