import type { Cause } from "effect"
import type { Frame } from "../machine/frame.js"
import type { HostRequest, Resolving } from "../machine/scheduler.js"
import { type AstNode, GeneratorReturn, type GeneratorRequestKind, typeError } from "./model.js"
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

/** What a native frame runs: interpreter work, or a machine task (a generator's body), which answers the same calls. */
export interface Body {
  next(input?: unknown): IteratorResult<Signal, unknown>
  throw(error: unknown): IteratorResult<Signal, unknown>
}

/** Run `body` in a native frame of its own; a boundary marks where the stack splits when the body above suspends. */
export class Call {
  constructor(
    readonly body: Body,
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

export type Signal = Call | Enter | Await | Yield | Host | Invoke | typeof Slice

/** What a generator body continues with: the `next`, `return`, or `throw` call that resumed it. */
export type GeneratorRequest = { readonly kind: GeneratorRequestKind; readonly value: Value }

/** Where the stack splits when the body above suspends, and what the activation below receives. */
export interface Boundary {
  /** An `await` above suspends here: an async function, an async generator, or the program. */
  readonly async: boolean
  /** A `yield` above suspends here. */
  readonly generator: boolean
  /** The body above returned or threw. */
  finish(completion: Completion): Completion
  /** The body above suspended at an `await`; its frames are parked on the awaited promise. */
  suspended(): Completion
  /** The body above yielded; `split` takes its frames off the stack when it suspends. */
  yielded(value: Value, split: () => Array<Frame>): Completion
}

/**
 * The boundary of host work that crosses its arguments first (a tool call): the caller receives the call's promise
 * at once, and a failure while crossing rejects it. Once the work starts, its outcome settles the promise.
 */
export class AsyncBoundary implements Boundary {
  readonly async = true
  readonly generator = false
  constructor(readonly resolving: Resolving) {}
  get result(): Value {
    return this.resolving.promise
  }
  finish(completion: Completion): Completion {
    if (!completion.ok) this.resolving.reject(completion.error)
    return normal(this.resolving.promise)
  }
  suspended(): Completion {
    return normal(this.resolving.promise)
  }
  yielded(): Completion {
    return abrupt(typeError("yield is only valid inside a generator."))
  }
}

/** Most activations one stack may hold, as the call-stack limit. */
export const MAX_CALL_DEPTH = 10_000

// Program values never have a `next` method of their own: an object's properties live in its property map.
export const isEval = <A>(value: A | Eval<A>): value is Eval<A> =>
  typeof value === "object" && value !== null && typeof (value as { readonly next?: unknown }).next === "function"

/** The body a generator object resumes: a `return()` request ends it with the returned value. */
export function* generatorBody(body: Iterable<Signal, Value, unknown>): Eval<Value> {
  try {
    return yield* body
  } catch (error) {
    if (error instanceof GeneratorReturn) return error.value
    throw error
  }
}
