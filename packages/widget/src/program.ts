import { createHash } from "node:crypto"
import { prelude } from "./source.js"
import type { JSONSchema } from "./json-schema.js"

export { prelude }

/** The program a client runs: the canonical prelude, a newline, then the template source. */
export function program(source: string) {
  return prelude + "\n" + source
}

/**
 * A template's content address: the first 16 hex chars of sha256(program(source) + "\n" + JSON.stringify(data)). It
 * covers the prelude because clients cache the served program by `name@version` forever.
 */
export function version(source: string, data: JSONSchema) {
  return createHash("sha256")
    .update(program(source) + "\n" + JSON.stringify(data))
    .digest("hex")
    .slice(0, 16)
}
