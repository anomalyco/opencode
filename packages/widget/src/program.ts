import { createHash } from "node:crypto"
import { parseProgram } from "psychoscript"
import { prelude } from "./source.js"
import type { JSONSchema } from "./json-schema.js"
import type { Capabilities, Mode } from "./template.js"

export { prelude }

/** The program a client runs: the canonical prelude, a newline, then the template source. */
export function program(source: string) {
  return prelude + "\n" + source
}

/** What a client appends to the program to run it in `mode` (one step, or `main` for a live template). */
export function entry(mode: Mode) {
  return mode === "live" ? "\nreturn await __widget_live(__input())" : "\nreturn __widget_step(__input())"
}

/**
 * A template's content address: the first 16 hex chars of sha256(program(source) + "\n" + JSON.stringify(data)); a
 * live template adds "\nlive", then "\n" + JSON.stringify(capabilities) when it declares any. It covers the prelude
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

// The source starts on the line after these: the prelude ends with a newline and `program` adds one.
const preludeLines = program("").split("\n").length - 1

/**
 * Compiles a template's program without running it. Returns the syntax error, with `line` counted in `source`, or
 * undefined when it compiles. Live templates are only compiled before they are shown, since `main` runs indefinitely.
 */
export function compile(source: string, mode: Mode = "step"): CompileError | undefined {
  const parsed = parseProgram(program(source) + entry(mode))
  if (parsed.ok) return
  const location = parsed.error.location
  if (!location || location.line <= preludeLines) return { message: parsed.error.message }
  const line = location.line - preludeLines
  // The interpreter counts lines in the whole program; report them in the template source.
  const message = parsed.error.message.replace(/\(line \d+, col (\d+)\)$/, `(line ${line}, col $1)`)
  return { message, line, column: location.column }
}

export interface CompileError {
  readonly message: string
  readonly line?: number
  readonly column?: number
}
