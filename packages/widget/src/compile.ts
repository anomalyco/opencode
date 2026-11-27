import { parseProgram } from "psychoscript"
import { entry, program } from "./program.js"
import type { Mode } from "./widget-template.js"

// Kept apart from program.ts so code that only needs programs and versions (the server) never loads the interpreter.

// The source starts on the line after the program's own: the preludes end with a newline and `program` adds one.
const preludeLines = {
  step: program("", "step").split("\n").length - 1,
  live: program("", "live").split("\n").length - 1,
}

/**
 * Compiles a widget template's program without running it. Returns the syntax error, with `line` counted in `source`, or
 * undefined when it compiles. Live widget templates are only compiled before they are shown, since `main` runs indefinitely.
 */
export function compile(source: string, mode: Mode = "step"): CompileError | undefined {
  const parsed = parseProgram(program(source, mode) + entry(mode))
  if (parsed.ok) return
  const location = parsed.error.location
  if (!location || location.line <= preludeLines[mode]) return { message: parsed.error.message }
  const line = location.line - preludeLines[mode]
  // The interpreter counts lines in the whole program; report them in the widget template source.
  const message = parsed.error.message.replace(/\(line \d+, col (\d+)\)$/, `(line ${line}, col $1)`)
  return { message, line, column: location.column }
}

export interface CompileError {
  readonly message: string
  readonly line?: number
  readonly column?: number
}
