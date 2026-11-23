import { Host } from "psychoscript"

// What the TypeScript widget host shares between steps and live runs.

/** The prelude<->host contract this host implements (specs/v2/widgets.md, Protocol). */
export const PROTOCOL = 2

/**
 * The boundary value depth widget runs need (specs/v2/widgets.md, Native hosts): the deepest value of a view of 100
 * levels, 1 + 2 × 99 + 3.
 */
export const MAX_VALUE_DEPTH = 202

/** Widget programs have typed arrays (specs/v2/widgets.md, Prelude and step ABI): psychoscript's opt-in. */
export const TYPED_ARRAYS = true

/** Why a host refuses a program built for another contract: a program error for an older one, a client error otherwise. */
export const OLDER = "This widget was built with an older widget runtime; ask the agent to post it again"
export const NEWER = "This widget needs a newer version of this app"

/** The contract `program` was built for: its first line's `__widget_protocol`, or 1 without one. */
export function protocol(program: string) {
  const declared = /^const __widget_protocol = (\d+)\n/.exec(program)
  return declared ? Number(declared[1]) : 1
}

// The standard error classes `Host.error` makes; another name is an `Error`.
type ErrorName = Parameters<typeof Host.error>[0]
const ERROR_NAMES: ReadonlySet<string> = new Set<ErrorName>([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "EvalError",
  "URIError",
  "AggregateError",
])

/**
 * A host function whose errors reach the program at the call's line and column, as the interpreter's own errors for an
 * argument do: what it throws becomes a `Host.error` of the same class and message.
 */
export const located = (f: (args: ReadonlyArray<unknown>, call: Host.Call) => unknown, options?: Host.Options) =>
  Host.fn((args, call) => {
    try {
      return f(args, call)
    } catch (error) {
      if (!(error instanceof Error)) throw error
      throw Host.error(ERROR_NAMES.has(error.name) ? (error.name as ErrorName) : "Error", error.message)
    }
  }, options)
