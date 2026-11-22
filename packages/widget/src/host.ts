import { Effect } from "effect"
import type { Host } from "psychoscript"
import { Host as EffectHost } from "psychoscript/effect"

// What the TypeScript widget host shares between steps and live runs.

/** The prelude<->host contract this host implements (specs/v2/widgets.md, Protocol). */
export const PROTOCOL = 2

/**
 * The boundary value depth widget runs need (specs/v2/widgets.md, Native hosts): the deepest value of a view of 100
 * levels, 1 + 2 × 99 + 3.
 */
export const MAX_VALUE_DEPTH = 202

/** Why a host refuses a program built for another contract: a program error for an older one, a client error otherwise. */
export const OLDER = "This widget was built with an older widget runtime; ask the agent to post it again"
export const NEWER = "This widget needs a newer version of this app"

/** The contract `program` was built for: its first line's `__widget_protocol`, or 1 without one. */
export function protocol(program: string) {
  const declared = /^const __widget_protocol = (\d+)\n/.exec(program)
  return declared ? Number(declared[1]) : 1
}

/**
 * A host function whose errors reach the program at the call's line and column, as the interpreter's own errors for
 * an argument do: what it throws becomes an Effect defect, which psychoscript gives the call's location.
 */
export const located = (f: (args: ReadonlyArray<unknown>, call: Host.Call) => unknown, options?: EffectHost.Options) =>
  EffectHost.fn((args, call) => {
    try {
      return f(args, call)
    } catch (error) {
      return Effect.die(error)
    }
  }, options)
