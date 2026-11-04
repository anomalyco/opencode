import type { Json } from "../data.js"
import { locate } from "../interpreter/errors.js"
import type { AstNode } from "../interpreter/model.js"
import type { Callable, GeneratorObj, Obj, PromiseObj, Value } from "../interpreter/objects.js"
import type { Completion } from "../interpreter/signals.js"
import type { Frame } from "./frame.js"
import type { Iter } from "./iteration.js"

// The scheduler's records: jobs, reactions, resolvers, and host calls. All of them are data the machine keeps, so a
// run's queue and the work it waits on can be read (and later saved) at any step boundary.

/** What the member reactions of one `Promise.all`/`allSettled`/`race`/`any` share. */
export type Combination = {
  readonly name: "all" | "allSettled" | "race" | "any"
  /** Settles the combinator's result. */
  readonly made: Resolving
  readonly values: Array<Value>
  readonly reasons: Array<Value>
  /** Members still to settle, plus one until iteration ends. */
  remaining: number
  /** Every member's reaction, detached once the result is decided. */
  readonly attached: Array<readonly [PromiseObj, Reaction]>
}

/**
 * A settled promise's reaction, as data. It runs as a job (see `react` in promises.ts) and either finishes at once or
 * starts interpreter work. The kinds:
 * - `await`: resume the frames parked on the promise, cut off the stack at an `await`.
 * - `settle`: pass the outcome on to `target`.
 * - `handler`: `then`/`catch` handlers; the handler's result settles `derived`.
 * - `combinator`: one member of a `Promise` combinator.
 * - `finally`, `finallyCleaned`, `finallyOutcome`: the steps of `Promise.prototype.finally` with a cleanup.
 * - `awaitReturn`: an async generator's `return(value)` once `value` settles.
 * - `asyncFromSync`: an async-from-sync iterator method's result value settled: answer `made` with it, closing the
 *   synchronous iterator `close` first on a rejection when one is given.
 */
export type Reaction =
  | { readonly kind: "await"; readonly frames: Array<Frame> }
  | { readonly kind: "settle"; readonly target: Resolving }
  | {
      readonly kind: "handler"
      readonly onFulfilled: Callable | undefined
      readonly onRejected: Callable | undefined
      readonly derived: Resolving
    }
  | { readonly kind: "combinator"; readonly combination: Combination; readonly index: number; called: boolean }
  | {
      readonly kind: "finally"
      readonly cleanup: Callable
      readonly target: Resolving
      readonly site: AstNode | undefined
    }
  | { readonly kind: "finallyCleaned"; readonly target: Resolving }
  | { readonly kind: "finallyOutcome"; readonly target: Resolving; readonly outcome: Completion }
  | { readonly kind: "awaitReturn"; readonly generator: GeneratorObj }
  | {
      readonly kind: "asyncFromSync"
      readonly made: Resolving
      readonly done: boolean
      readonly close: Iter | undefined
      readonly site: AstNode
    }

/** One queued job, as data: run a settled promise's reaction (resuming parked frames, say), or adopt a thenable. */
export type Job =
  | { readonly kind: "reaction"; readonly reaction: Reaction; readonly settled: Completion }
  | { readonly kind: "thenable"; readonly promise: PromiseObj; readonly thenable: Obj; readonly then: Value }

/**
 * What host work a call asks for. A tool call or a search is data; an extension's work is a live host value the driver
 * runs as it is.
 */
export type HostRequest =
  | { readonly kind: "tool"; readonly path: ReadonlyArray<string>; readonly args: Array<Json | undefined> }
  | { readonly kind: "search"; readonly args: Array<Json | undefined> }
  | { readonly kind: "effect"; readonly effect: unknown }

/**
 * Host work the program waits on. The machine queues it and hands it to the driver at its next stop; the driver runs
 * it and reports how it ended with `Machine.complete`. A concurrent call's outcome waits in the inbox and settles its
 * promise in a later job; a blocking call stops the machine, and no other job runs until it ends.
 */
export class HostCall {
  status: "queued" | "inFlight" | "completed" = "queued"
  constructor(
    readonly id: number,
    readonly request: HostRequest,
    /** What runs: a tool path, or an extension function's label. */
    readonly label: string,
    /** The running job waits for it: its outcome continues the frame that asked, before any other job. */
    readonly blocking: boolean,
    /** How a concurrent call's result becomes a program value: a tool's crosses as JSON, an extension's is one. */
    readonly result: "json" | "value",
    /** Settles a concurrent call's promise. */
    readonly resolving: Resolving | undefined,
    /** The call that started the work, where a defect it raises is located. */
    readonly site: AstNode | undefined,
  ) {}
}

/**
 * CreateResolvingFunctions as data: settles one promise at most once, however many `Resolver`s share it. `reject` takes
 * the failure as thrown; one without a location is located at `site`, the call that created the promise.
 */
export class Resolving {
  done = false
  constructor(
    private readonly scheduler: Settles,
    readonly promise: PromiseObj,
    readonly site: AstNode | undefined,
  ) {}

  resolve(resolution: Value): void {
    if (this.done) return
    this.done = true
    this.scheduler.resolveWith(this.promise, resolution, this.site)
  }

  reject(reason: unknown): void {
    if (this.done) return
    this.done = true
    this.scheduler.reject(this.promise, locate(reason, this.site))
  }
}

type Settles = {
  resolveWith(promise: PromiseObj, resolution: Value, site?: AstNode): void
  reject(promise: PromiseObj, reason: unknown): void
}

/**
 * Why `Machine.run` stopped:
 * - `done`: the program's body ended, with its completion.
 * - `host`: start `calls`, newly queued host work, in order (a blocking call is last, and the machine continues only
 *   once it completes). With no calls, the machine waits for host work already running to complete.
 * - `slice`: the step budget is used up; let the host run, then continue.
 * - `stuck`: nothing can run or settle any more; `node` is the `await` that waits forever, when one is known.
 */
export type Stop =
  | { readonly kind: "done"; readonly completion: Completion }
  | { readonly kind: "host"; readonly calls: ReadonlyArray<HostCall> }
  | { readonly kind: "slice" }
  | { readonly kind: "stuck"; readonly node: AstNode | undefined }
