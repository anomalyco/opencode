export * as MachinePath from "./path.js"

import { Effect, Schema } from "effect"
import { Environment } from "../environment/index.js"
import { EnvironmentPath } from "../environment/path.js"
import { Machines } from "./machines.js"

export const NotAbsolute = EnvironmentPath.NotAbsolute
export type NotAbsolute = EnvironmentPath.NotAbsolute

export interface Parsed {
  readonly machine: Environment.ID
  /** The rest as written, `/...` or `~...`: locating a path owner normalizes it. */
  readonly path: string
}

/** Splits `gpu:/work/a` or `gpu:~/a` into a machine and the rest. A Windows drive, URL, `local:`, or workspace ID is not one. */
export const parse = (text: string): Parsed | undefined => {
  const parsed = EnvironmentPath.parse(text)
  if (!parsed || !Schema.is(Machines.Name)(parsed.environment)) return
  return { machine: parsed.environment, path: parsed.path }
}

/** Reads text someone typed as a paired machine path, refusing non-rooted paths for known paired machines. */
export const typed = Effect.fnUntraced(function* (text: string, machines: Machines.Interface) {
  const parsed = parse(text)
  if (parsed) return parsed
  const colon = text.indexOf(":")
  if (colon <= 0) return
  const machine = text.slice(0, colon)
  const rest = text.slice(colon + 1)
  if (!Schema.is(Machines.Name)(machine) || rest.startsWith("/") || rest.startsWith("~")) return
  if ((yield* machines.list()).some((info) => info.id === machine))
    return yield* new NotAbsolute({ machine: Environment.ID.make(machine) })
})

/** A machine path's text: what `parse` reads back. */
export const format = EnvironmentPath.format

/** A local path's text, kept from reading as a machine path via a leading `./`. */
export const local = (path: string) => (parse(path) ? `./${path}` : path)
