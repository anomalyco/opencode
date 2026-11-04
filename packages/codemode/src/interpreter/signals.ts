import type { Cause } from "effect"
import type { Frame, Kind } from "../machine/frame.js"
import type { HostRequest } from "../machine/scheduler.js"
import type { AstNode, GeneratorRequestKind } from "./model.js"
import type { Value } from "./objects.js"

// What frames ask the machine for (signals), and what built-ins return when their result is not a plain value: frames
// to run, a call to make, or conversions to run first. All of it is data; nothing here needs Effect at run time.

export type Completion =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown }

export const normal = (value: unknown): Completion => ({ ok: true, value })
export const abrupt = (error: unknown): Completion => ({ ok: false, error })

/** Push saved frames back on the stack and continue the top one with `input`. */
export class Enter {
  constructor(
    readonly frames: Array<Frame>,
    readonly input: Completion,
  ) {}
}

/** Push a fresh frame of `kind` with `slots`, located at the call that asks; its result is the call's. */
export class Push {
  constructor(
    readonly kind: Kind,
    readonly slots: Array<unknown>,
  ) {}
}

/**
 * A built-in needs `values` converted to primitives (ToPrimitive with `hints`, in order) before it can go on: the
 * conversions run as a frame, then the built-in runs again from the start, and its `ordinal`-th conversion receives
 * them. See `withPrimitives`.
 */
export class Convert {
  constructor(
    readonly hints: Hints,
    readonly values: ReadonlyArray<Value>,
    readonly ordinal: number,
    /** Also apply ToNumber or ToString to each one before converting the next. */
    readonly coerce: boolean,
  ) {}
}

export type Hint = "number" | "string" | "default"
export type Hints = Hint | ReadonlyArray<Hint>

/** Suspend the innermost async body until `value` settles; a stall while it waits is reported at `node`. */
export class Await {
  constructor(
    readonly value: Value,
    readonly node?: AstNode,
  ) {}
}

/** Suspend the innermost generator body, producing `value`; it continues with the next request. */
export class Yield {
  constructor(readonly value: Value) {}
}

/** Block the current job on host work: no other job runs until it ends, as with a synchronous host call. */
export class Host {
  constructor(readonly request: HostRequest) {}
}

/**
 * Host work that was interrupted on its own. It settles its promise like a rejection, but program code cannot catch
 * it: handlers, `catch`, and `finally` are skipped, an unobserved one is not reported, and one that reaches the
 * program's body interrupts the execution.
 */
export class Interruption {
  constructor(readonly cause: Cause.Cause<unknown>) {}
}

/** Let the host run; the current job continues before any other job. */
export const Slice: unique symbol = Symbol("codemode.slice")

/** A call a built-in hands on (`Function.prototype.call`, say): the machine makes it as the built-in's own result. */
export class Invoke {
  constructor(
    readonly callable: Value,
    readonly thisValue: Value,
    readonly args: Array<Value>,
    readonly site: AstNode | undefined,
  ) {}
}

export type Signal = Enter | Await | Yield | Host | typeof Slice

/** What a generator body continues with: the `next`, `return`, or `throw` call that resumed it. */
export type GeneratorRequest = { readonly kind: GeneratorRequestKind; readonly value: Value }

/** Most activations one stack may hold, as the call-stack limit. */
export const MAX_CALL_DEPTH = 10_000
