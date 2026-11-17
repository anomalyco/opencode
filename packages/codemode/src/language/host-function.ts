export * as Host from "./host-function.js"

import type { Effect } from "effect"
import type { Json } from "./data.js"
import { HostFailure } from "./runtime/model.js"

// Host functions a program calls as globals. Arguments cross into the host as copies (`Date`, `Map`, `Set`,
// `Uint8Array`, `URL`, `Headers`, errors, plain data), and results cross back the same way; a function inside a
// result is callable too. A host function may return a value, a Promise, or an Effect, and an Effect's requirements
// join the runtime's environment.

/** What every call of a host function gets. */
export type Call = {
  /** The call's key, `<runId>:<callId>`: the same across a suspended run's resumes. */
  readonly key: string
  /** Whether the run is being suspended: an interruption now detaches the call instead of ending it. */
  readonly suspending: () => boolean
}

/** What every call of a durable function gets: also the arguments it was called with, as they crossed. */
export type DurableCall = Call & { readonly args: ReadonlyArray<unknown> }

/**
 * Lets a saved run keep the functions inside values a host function returned: `encode` gets such a value and gives
 * plain data (JSON values and `Uint8Array`s); `decode` gets that data back on resume and gives a value of the same
 * shape, whose functions the program's copies call from then on. Without it, those functions are lost on resume.
 */
export type Snapshot = {
  readonly encode: (value: unknown) => unknown
  readonly decode: (data: unknown) => unknown
}

/**
 * How a call reaches the program:
 * - `sync`: the program waits for the function. An Effect runs until it ends; whatever is still pending then (a
 *   returned Promise, or a Promise or Effect the Effect produced) reaches the program as a promise.
 * - `async`: the program gets a promise at once, and the function runs once the program's current step ends.
 * - `sync-thenable`: as `sync`, and an object result also has hidden `then`, `catch` and `finally`, so the program can
 *   use it directly or await it.
 */
export type Type = "sync" | "async" | "sync-thenable"

export type Options =
  | {
      readonly type?: "sync" | "sync-thenable"
      readonly idempotent?: false
      readonly snapshot?: Snapshot | undefined
      /**
       * Lets a program call the function with `new`, as it would a class. `new` calls it the same way a plain call
       * does, and the program gets what it returns.
       */
      readonly constructible?: boolean
      /**
       * Lets the program pass back a function that was inside a result, on its own or inside an argument: it arrives
       * as the host function itself, and the run can't be suspended until the call completes. Without it, such a
       * function is treated like any other function in an argument (see `Runtime.Translate`).
       */
      readonly takesFunctions?: boolean
    }
  | {
      readonly type: "async"
      /**
       * Safe to run twice: a suspend interrupts a call in progress, and the resumed run calls it again with the same
       * key. Without it, a suspend fails while a call is in progress.
       */
      readonly idempotent?: boolean
      readonly snapshot?: Snapshot | undefined
      readonly constructible?: boolean
      readonly takesFunctions?: boolean
    }

/** A host function; see `fn`. */
export class Fn<R = never> {
  declare readonly requirements?: (_: never) => R
  constructor(
    readonly run: (args: ReadonlyArray<unknown>, call: Call) => unknown,
    readonly type: Type,
    readonly idempotent: boolean,
    readonly snapshot: Snapshot | undefined,
    readonly constructible = false,
    readonly takesFunctions = false,
  ) {}
}

/** A host function whose work keeps running across a suspend; see `durableFn`. */
export class DurableFn<R = never> {
  declare readonly requirements?: (_: never) => R
  constructor(
    readonly start: (args: ReadonlyArray<unknown>, call: Call) => Effect.Effect<Json, unknown, R>,
    readonly wait: (data: Json, call: DurableCall) => Effect.Effect<unknown, unknown, R>,
    readonly cancel: (data: Json, call: DurableCall) => Effect.Effect<void, unknown, R>,
  ) {}
}

/** A lazy object of host functions, addressed by path; see `namespace`. */
export class Namespace<R = never> {
  declare readonly requirements?: (_: never) => R
  constructor(
    readonly keys: (path: ReadonlyArray<string>) => ReadonlyArray<string>,
    readonly resolve: (path: ReadonlyArray<string>) => Fn<R> | DurableFn<R> | HostFailure,
  ) {}
}

export { HostFailure as Failure }

type Requirements<A> = A extends Effect.Effect<infer _A, infer _E, infer R> ? R : never

/** A host function: `f` gets the program's arguments, as they crossed, and the call. */
export const fn = <F extends (args: ReadonlyArray<any>, call: Call) => unknown>(
  f: F,
  options: Options = {},
): Fn<Requirements<ReturnType<F>>> =>
  new Fn(
    f,
    options.type ?? "sync",
    options.type === "async" && options.idempotent === true,
    options.snapshot,
    options.constructible === true,
    options.takesFunctions === true,
  )

/**
 * A host function whose work keeps running across a suspend. `start` begins it and gives JSON data, kept in a saved
 * run; `wait(data)` runs right after, and again after a resume, for the result. `cancel(data)` runs only when the run
 * is interrupted, or ends with the work still running. The program always gets a promise.
 */
export const durableFn = <Data extends Json, R = never>(options: {
  readonly start: (args: ReadonlyArray<any>, call: Call) => Effect.Effect<Data, unknown, R>
  readonly wait: (data: Data, call: DurableCall) => Effect.Effect<unknown, unknown, R>
  readonly cancel: (data: Data, call: DurableCall) => Effect.Effect<void, unknown, R>
}): DurableFn<R> =>
  new DurableFn<R>(
    options.start,
    options.wait as (data: Json, call: DurableCall) => Effect.Effect<unknown, unknown, R>,
    options.cancel as (data: Json, call: DurableCall) => Effect.Effect<void, unknown, R>,
  )

/**
 * A lazy object of host functions, for catalogs too large to build as objects. `keys(path)` lists the names under a
 * path, for `Object.keys` and `for...in`; `resolve(path)` gives the function a call reaches, or a failure (see
 * `missing`) the call throws. Any path can be read, so `ns.a.b` is a path whether or not anything is there.
 */
export const namespace = <R = never>(options: {
  readonly keys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
  readonly resolve: (path: ReadonlyArray<string>) => Fn<R> | DurableFn<R> | HostFailure
}): Namespace<R> => new Namespace(options.keys, options.resolve)

/** A failure with its own diagnostic `kind` and `suggestions`, to throw or fail with from a host function. */
export const fail = (kind: string, message: string, suggestions?: ReadonlyArray<string>): HostFailure =>
  new HostFailure(kind, message, suggestions)

/** What `resolve` gives for a path with no function: calling it throws this failure. */
export const missing = (message: string, suggestions?: ReadonlyArray<string>, kind = "ExecutionFailure"): HostFailure =>
  new HostFailure(kind, message, suggestions)
