import type { Cause } from "effect"
import type { Frame, Kind } from "../machine/frame.js"
import type { HostRequest, Resolving } from "../machine/scheduler.js"
import type { AstNode, GeneratorRequestKind } from "./model.js"
import type { Value } from "./objects.js"

// The signals interpreter work (a built-in's host generator) sends the machine. Nothing here needs Effect at run time.

/**
 * Interpreter work: a generator that yields signals to the machine and returns its result. It runs in a native frame;
 * a program call is an `Invoke`, which the machine runs as frames on its own stack, so program recursion never grows
 * the host stack.
 */
export type Eval<A> = Generator<Signal, A, unknown>

export type Completion =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown }

export const normal = (value: unknown): Completion => ({ ok: true, value })
export const abrupt = (error: unknown): Completion => ({ ok: false, error })

/** Run `body` in a native frame of its own; a boundary marks where the stack splits when the body above suspends. */
export class Call {
  constructor(
    readonly body: Eval<unknown>,
    readonly boundary?: Boundary,
  ) {}
}

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

/** Call a program function from inside interpreter work; the machine runs the call as frames on its own stack. */
export class Invoke {
  constructor(
    readonly callable: Value,
    readonly thisValue: Value,
    readonly args: Array<Value>,
    readonly site: AstNode | undefined,
  ) {}
}

export type Signal = Call | Enter | Push | Await | Yield | Host | Invoke | typeof Slice

/** What a generator body continues with: the `next`, `return`, or `throw` call that resumed it. */
export type GeneratorRequest = { readonly kind: GeneratorRequestKind; readonly value: Value }

/** Where the stack splits when the body above suspends at an `await`, and what the activation below receives. */
export interface Boundary {
  /** The body above returned or threw. */
  finish(completion: Completion): Completion
  /** The body above suspended at an `await`; its frames are parked on the awaited promise. */
  suspended(): Completion
}

/**
 * The boundary of host work that crosses its arguments first (a tool call): the caller receives the call's promise
 * at once, and a failure while crossing rejects it. Once the work starts, its outcome settles the promise.
 */
export class AsyncBoundary implements Boundary {
  constructor(readonly resolving: Resolving) {}
  finish(completion: Completion): Completion {
    if (!completion.ok) this.resolving.reject(completion.error)
    return normal(this.resolving.promise)
  }
  suspended(): Completion {
    return normal(this.resolving.promise)
  }
}

/** Most activations one stack may hold, as the call-stack limit. */
export const MAX_CALL_DEPTH = 10_000

// Program values never have a `next` method of their own: an object's properties live in its property map.
export const isEval = <A>(value: A | Eval<A>): value is Eval<A> =>
  typeof value === "object" && value !== null && typeof (value as { readonly next?: unknown }).next === "function"
