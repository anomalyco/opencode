import type { Cause, Effect } from "effect"
import { type AstNode, GeneratorReturn, type GeneratorRequestKind, typeError } from "./model.js"
import type { Value } from "./objects.js"

// The signals interpreter work sends its driver, and the activation records the driver keeps. Nothing here needs
// Effect at run time, so the machine can use them too.

/**
 * Interpreter work: a generator that yields signals to the driver and returns its result. Work inside one activation
 * composes with `yield*`; a program call is a `Call`, so program recursion lives on the explicit stack below and never
 * grows the host stack.
 */
export type Eval<A> = Generator<Signal, A, unknown>

export type Completion =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown }

export const normal = (value: unknown): Completion => ({ ok: true, value })
export const abrupt = (error: unknown): Completion => ({ ok: false, error })

/**
 * What an activation's body is: interpreter work, or a machine task (`src/machine`), which answers the same `next` and
 * `throw` as a generator.
 */
export interface Body {
  next(input?: unknown): IteratorResult<Signal, unknown>
  throw(error: unknown): IteratorResult<Signal, unknown>
}

/** Run `body` as a new activation; a boundary marks where a suspended body splits off the stack. */
export class Call {
  constructor(
    readonly body: Body,
    readonly boundary?: Boundary,
  ) {}
}

/** Push saved activations back on the stack and continue the top one with `input`. */
export class Enter {
  constructor(
    readonly entries: Array<Entry>,
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
  constructor(readonly effect: Effect.Effect<unknown, unknown>) {}
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

/**
 * Call a program function from inside interpreter work. The machine evaluator answers it on its own stack; the
 * runner, when it reaches it, starts the call as a new activation.
 */
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
  /** The body above suspended at an `await`; its activations are saved in the continuation. */
  suspended(): Completion
  /** The body above yielded; `split` takes its activations off the stack when it suspends. */
  yielded(value: Value, split: () => Array<Entry>): Completion
}

/** The boundary of an async body: the body's completion settles it, and the caller receives `result` at once. */
export class AsyncBoundary implements Boundary {
  readonly async = true
  readonly generator = false
  constructor(
    private readonly settle: (completion: Completion) => void,
    readonly result: Value,
  ) {}
  finish(completion: Completion): Completion {
    this.settle(completion)
    return normal(this.result)
  }
  suspended(): Completion {
    return normal(this.result)
  }
  yielded(): Completion {
    return abrupt(typeError("yield is only valid inside a generator."))
  }
}

export type Entry = { readonly body: Body; readonly boundary: Boundary | undefined }

/** Paused or running program code: activations on an explicit stack, innermost last. */
export class Task {
  constructor(readonly stack: Array<Entry>) {}
}

/** Most activations one task may hold, as the call-stack limit. */
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
