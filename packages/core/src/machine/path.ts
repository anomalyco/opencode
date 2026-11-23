export * as MachinePath from "./path.js"

import { Effect, Schema } from "effect"
import { Environment } from "../environment/index.js"
import { Machines } from "./machines.js"

export interface Parsed {
  readonly machine: Environment.ID
  /** The rest as written, `/...` or `~...`: locating a path owner normalizes it. */
  readonly path: string
}

export class NotAbsolute extends Schema.TaggedError<NotAbsolute>()("Machine.NotAbsolute", {
  machine: Environment.ID,
}) {
  override get message() {
    return `Machine paths are absolute or start with ~/: write ${this.machine}:/… or ${this.machine}:~/… (for a local folder with that name, start with ./)`
  }
}

/** Splits `name:rest` at a name a machine could have. A Windows drive is not one. */
const split = (text: string): Parsed | undefined => {
  const colon = text.indexOf(":")
  if (colon <= 0) return
  const machine = text.slice(0, colon)
  if (!Schema.is(Machines.Name)(machine)) return
  return { machine: Environment.ID.make(machine), path: text.slice(colon + 1) }
}

const rooted = (path: string) => path.startsWith("/") || path.startsWith("~")

/** Splits `gpu:/work/a` or `gpu:~/a` into a machine and the rest. A Windows drive or any URL is not one. */
export const parse = (text: string) => {
  const named = split(text)
  if (!named || !rooted(named.path) || named.path.startsWith("//")) return
  return named
}

/**
 * Reads text someone typed: a machine path, or nothing when it is a path on this server. A machine path is absolute
 * or starts with ~/, so `gpu:work` is no machine path and would quietly be this server's folder. Only a name that is a
 * machine here is refused: another name stays a local folder, as before.
 */
export const typed = Effect.fnUntraced(function* (text: string, machines: Machines.Interface) {
  const parsed = parse(text)
  if (parsed) return parsed
  const named = split(text)
  if (!named || rooted(named.path)) return
  if ((yield* machines.list()).some((info) => info.id === named.machine))
    return yield* new NotAbsolute({ machine: named.machine })
})

/** A machine path's text: what `parse` reads back. */
export const format = (machine: Environment.ID, path: string) => `${machine}:${path}`

/** A local path's text, kept from reading as a machine path: a folder here can be named like one, and `./` keeps it local. */
export const local = (path: string) => (parse(path) ? `./${path}` : path)
