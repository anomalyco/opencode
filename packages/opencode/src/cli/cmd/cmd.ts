import type { CommandModule } from "yargs"

type WithDoubleDash<T> = T & { "--"?: string[] }

/**
 * Wraps a yargs command module with double-dash argument support.
 *
 * This helper ensures command modules properly handle arguments after `--`,
 * which is essential for passing arguments through to underlying commands.
 *
 * @param input The yargs command module to wrap
 * @returns The same command module with proper type inference for double-dash args
 */
export function cmd<T, U>(input: CommandModule<T, WithDoubleDash<U>>) {
  return input
}
