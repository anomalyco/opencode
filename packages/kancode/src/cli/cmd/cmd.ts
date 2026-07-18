import type { CommandModule } from "yargs"

export type WithDoubleDash<T> = T & { "--"?: string[]; _?: Array<string | number> }

export function cmd<T, U>(input: CommandModule<T, WithDoubleDash<U>>) {
  return input
}
