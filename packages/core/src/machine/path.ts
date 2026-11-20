export * as MachinePath from "./path.js"

import { Schema } from "effect"
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
    return `A ${this.machine} path must be absolute or start with ~/, as in ${this.machine}:/work/file.`
  }
}

/** Splits `gpu:/work/a` or `gpu:~/a` into a machine and the rest. A Windows drive or any URL is not one. */
export const parse = (text: string): Parsed | undefined => {
  const colon = text.indexOf(":")
  if (colon <= 0) return
  const machine = text.slice(0, colon)
  if (!Schema.is(Machines.Name)(machine)) return
  const rest = text.slice(colon + 1)
  if (!rest.startsWith("/") && !rest.startsWith("~")) return
  if (rest.startsWith("//")) return
  return { machine: Environment.ID.make(machine), path: rest }
}
