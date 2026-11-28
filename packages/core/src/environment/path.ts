export * as EnvironmentPath from "./path.js"

import { Effect, Schema } from "effect"
import { Machines } from "../machine/machines.js"
import { Workspace } from "../workspace.js"
import { Environment } from "./index.js"

export interface Parsed {
  readonly environment: Environment.ID
  /** The rest as written, `/...`, `~...`, or a drive or backslash path: locating a path owner checks and normalizes it. */
  readonly path: string
}

export class NotAbsolute extends Schema.TaggedError<NotAbsolute>()("Machine.NotAbsolute", {
  machine: Environment.ID,
  /** The machine runs Windows, where an absolute path starts at a drive. */
  windows: Schema.optionalKey(Schema.Boolean),
}) {
  override get message() {
    const absolute = this.windows ? `${this.machine}:C:\\…` : `${this.machine}:/…`
    return `Machine paths are absolute or start with ~/: write ${absolute} or ${this.machine}:~/… (for a local folder with that name, start with ./)`
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

// A machine may be Windows, so a drive or backslash path there (`win:C:\…`, `win:\\server\…`) is read as its own
// and locating it checks it by the machine's rules. On a Windows host a drive path is rooted too (`local:C:\…`). A
// workspace sandbox and any other host resolve one as relative, so it stays refused there.
const rooted = (named: Parsed) =>
  named.path.startsWith("/") ||
  named.path.startsWith("~") ||
  (Schema.is(Machines.Name)(named.environment) && /^(?:[A-Za-z]:[\\/]|\\)/.test(named.path)) ||
  (named.environment === Environment.localID && process.platform === "win32" && /^[A-Za-z]:[\\/]/.test(named.path))

/**
 * Splits `local:/a`, `gpu:/work/a`, `gpu:~/a`, `win:C:\a`, or `wrk_...:/workspace` into an environment and the rest.
 * A bare Windows drive (`C:\a`) or any URL (`skill://`, `https://`) is not an environment path.
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
export const typed = Effect.fnUntraced(function* (text: string, has: (id: Environment.ID) => Effect.Effect<boolean>) {
  const parsed = parse(text)
  if (parsed) return parsed
  const named = split(text)
  if (!named || rooted(named)) return
  if (yield* has(named.environment)) return yield* new NotAbsolute({ machine: named.environment })
})

/** An environment path's text: what `parse` reads back. */
export const format = (environment: Environment.ID, path: string) => `${environment}:${path}`

/** A local path's text, kept from reading as an environment path via a leading `./`. */
export const local = (path: string) => (parse(path) ? `./${path}` : path)
