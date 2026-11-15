import type { Cause } from "effect"
import type { AstNode, GeneratorRequestKind } from "./model.js"
import type { GeneratorObj, Value } from "./objects.js"

// What built-ins return when their result is not a plain value (work for the VM, a generator to resume, a call to
// make, or conversions to run first), and how work completes. All of it is data; nothing here needs Effect at run time.

export type Completion =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown }

export const normal = (value: unknown): Completion => ({ ok: true, value })
export const abrupt = (error: unknown): Completion => ({ ok: false, error })

/**
 * Work a built-in hands to the VM, by name, with its arguments: VM-side TS or a prelude function runs it at the call,
 * and its result is the call's (see `Vm.settleNativeResult`).
 */
export class Push {
  constructor(
    readonly kind: PushKind,
    readonly slots: Array<unknown>,
  ) {}
}

export type PushKind =
  | "JSON.stringify"
  | "AsyncFromSyncIterator"
  | "Promise executor"
  | "Promise.try"
  | "Promise combinator"
  | "search"
  | "extension call"

/** Continue a suspended generator's frame with `request`: what `next`/`return`/`throw` return once it can run. */
export class Resume {
  constructor(
    readonly generator: GeneratorObj,
    readonly request: GeneratorRequest,
  ) {}
}

/**
 * A built-in needs `values` converted to primitives (ToPrimitive with `hints`, in order) before it can go on: the
 * conversions run as prelude code, then the built-in runs again from the start, and its `ordinal`-th conversion
 * receives them. See `withPrimitives`.
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

/**
 * Host work that was interrupted on its own. It settles its promise like a rejection, but program code cannot catch
 * it: handlers, `catch`, and `finally` are skipped, an unobserved one is not reported, and one that reaches the
 * program's body interrupts the execution.
 */
export class Interruption {
  constructor(readonly cause: Cause.Cause<unknown>) {}
}

/** A call a built-in hands on (`Function.prototype.call`, say): the VM makes it as the built-in's own result. */
export class Invoke {
  constructor(
    readonly callable: Value,
    readonly thisValue: Value,
    readonly args: Array<Value>,
    readonly site: AstNode | undefined,
  ) {}
}

/** What a generator body continues with: the `next`, `return`, or `throw` call that resumed it. */
export type GeneratorRequest = { readonly kind: GeneratorRequestKind; readonly value: Value }

/** Most activations one stack may hold, as the call-stack limit. */
export const MAX_CALL_DEPTH = 10_000
