import { createHash } from "node:crypto"
import { prelude } from "./source.js"
import type { JSONSchema } from "./json-schema.js"

export { prelude }

/** The program a client runs: the canonical prelude, a newline, then the template source. */
export function program(source: string) {
  return prelude + "\n" + source
}

/**
 * A template's content address: the first 16 hex chars of sha256(program(source) + "\n" + JSON.stringify(data)), plus
 * "\nlive" for a live template. It covers the prelude because clients cache the served program by `name@version`
 * forever, and the mode because it decides how the program runs.
 */
export function version(source: string, data: JSONSchema, mode: "step" | "live" = "step") {
  return createHash("sha256")
    .update(program(source) + "\n" + JSON.stringify(data) + (mode === "live" ? "\nlive" : ""))
    .digest("hex")
    .slice(0, 16)
}
