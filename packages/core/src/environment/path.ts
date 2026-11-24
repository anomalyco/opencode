export * as EnvironmentPath from "./path.js"

import { Effect, Schema } from "effect"
import { Machines } from "../machine/machines.js"
import { Workspace } from "../workspace.js"
import { Environment } from "./index.js"

export interface Parsed {
  readonly environment: Environment.ID
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

const isEnvironmentPrefix = (name: string) =>
  name === Environment.localID || Workspace.isID(name) || Schema.is(Machines.Name)(name)

/** Splits `env:rest` at a name an environment could have (local, workspace ID, or machine name). */
const split = (text: string): Parsed | undefined => {
  const colon = text.indexOf(":")
  if (colon <= 0) return
  const environment = text.slice(0, colon)
  if (!isEnvironmentPrefix(environment)) return
  return { environment: Environment.ID.make(environment), path: text.slice(colon + 1) }
}

// On a Windows host a drive path is rooted too, so `local:C:\…` reaches its files. Other environments and hosts
// resolve one as relative, so it stays refused there.
const rooted = (named: Parsed) =>
  named.path.startsWith("/") ||
  named.path.startsWith("~") ||
  (named.environment === Environment.localID && process.platform === "win32" && /^[A-Za-z]:[\\/]/.test(named.path))

/**
 * Splits `local:/a`, `gpu:/work/a`, `gpu:~/a`, or `wrk_...:/workspace` into an environment and the rest.
 * A Windows drive or any URL (`skill://`, `https://`) is not an environment path.
 */
export const parse = (text: string): Parsed | undefined => {
  const named = split(text)
  if (!named || !rooted(named) || named.path.startsWith("//")) return
  return named
}

/**
 * Reads text someone typed: an environment path, or nothing when it is a plain path in the current environment.
 * Non-rooted `name:relative` text is refused for reserved environment prefixes (`local:`, `wrk_...:`) and
 * known paired machines so typos never silently misroute to another environment's relative path.
 */
export const typed = Effect.fnUntraced(function* (text: string, machines: Machines.Interface) {
  const parsed = parse(text)
  if (parsed) return parsed
  const named = split(text)
  if (!named || rooted(named)) return
  if (
    named.environment === Environment.localID ||
    Workspace.isID(named.environment) ||
    (yield* machines.list()).some((info) => info.id === named.environment)
  )
    return yield* new NotAbsolute({ machine: named.environment })
})

/** An environment path's text: what `parse` reads back. */
export const format = (environment: Environment.ID, path: string) => `${environment}:${path}`

/** A local path's text, kept from reading as an environment path via a leading `./`. */
export const local = (path: string) => (parse(path) ? `./${path}` : path)
