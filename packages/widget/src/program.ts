import { createHash } from "node:crypto"
import { prelude } from "./source.js"
import type { JSONSchema } from "./json-schema.js"
import type { Capabilities, Mode } from "./widget-template.js"

export { prelude }

/** The program a client runs: the canonical prelude, a newline, then the widget template source. */
export function program(source: string) {
  return prelude + "\n" + source
}

/** What a client appends to the program to run it in `mode` (one step, or `main` for a live widget template). */
export function entry(mode: Mode) {
  return mode === "live" ? "\nreturn await __widget_live(__input())" : "\nreturn __widget_step(__input())"
}

/**
 * A widget template's content address: the first 16 hex chars of sha256(program(source) + "\n" + JSON.stringify(data)); a
 * live widget template adds "\nlive", then "\n" + JSON.stringify(capabilities) when it declares any. It covers the prelude
 * because clients cache the served program by `name@version` forever, and the mode and capabilities because they
 * decide how the program runs.
 */
export function version(source: string, data: JSONSchema, mode: Mode = "step", capabilities?: Capabilities) {
  const live = mode === "live" ? "\nlive" + (capabilities === undefined ? "" : "\n" + JSON.stringify(capabilities)) : ""
  return createHash("sha256")
    .update(program(source) + "\n" + JSON.stringify(data) + live)
    .digest("hex")
    .slice(0, 16)
}
