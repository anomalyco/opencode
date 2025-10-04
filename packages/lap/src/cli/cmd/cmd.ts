import type { CommandModule } from "yargs"

export function cmd<T, U>(input: CommandModule<T, U>) {
  return input
}
