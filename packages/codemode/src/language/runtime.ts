export * as Runtime from "./runtime.js"

import { Deferred, Effect, Exit } from "effect"
import type { Json } from "./data.js"
import type { DurableFn, Fn, Namespace } from "./host-function.js"
import {
  finishExecution,
  type Outcome,
  type Result,
  resumeProgram,
  type Run,
  type Running,
  type Setup,
  startProgram,
  SuspendError,
  type Suspended,
} from "./runtime/execute.js"
import type { SnapshotError } from "./snapshot/snapshot.js"

export { SuspendError }
export type { Outcome, Result, Run, Suspended }

/** Budgets enforced on each run. Time counts active time only, across every resume of a run. */
export type Limits = {
  /** Wall-clock milliseconds before interruption. No default: absent means no timeout. */
  readonly timeoutMs?: number
  /**
   * Maximum UTF-8 bytes retained from the result and logs. Warnings have a separate equal budget; truncation notices
   * are additional.
   */
  readonly maxOutputBytes?: number
}

/**
 * How a host call's arguments carry program values the host can't hold. Every host function in the runtime gets its
 * arguments this way; results are not affected.
 */
export type Translate = {
  /**
   * A program function inside an argument: `"error"` (the default) fails the call; `"drop"` leaves it out, as
   * `JSON.stringify` does: an object's key is left out, an array's item is `null`, and an argument is `undefined`.
   */
  readonly functions?: "error" | "drop" | undefined
  /**
   * A program promise inside an argument: `"error"` (the default) fails the call; `"await"` makes the call wait for it
   * to settle and use its value. A rejection fails the call with its reason.
   */
  readonly promises?: "error" | "await" | undefined
}

/** A runtime's host globals for one run: `Host.fn`, `Host.durableFn`, `Host.namespace`, and plain values of them. */
export type Globals = Readonly<Record<string, unknown>>

export type Options<G extends Globals = Globals> = {
  /**
   * The globals a program reaches, made for each run when it starts and again when it resumes, so they can keep the
   * run's own state in `run.metadata`.
   */
  readonly globals?: ((run: Run) => G) | undefined
  readonly limits?: Limits | undefined
  readonly translate?: Translate | undefined
}

/** Options for `Runtime.program`. */
export type ProgramOptions = {
  /** Read-only JSON values bound in the program's outer scope (shadowable by top-level declarations). */
  readonly bindings?: Readonly<Record<string, Json>> | undefined
  /** Names this run's host calls (`<runId>:<callId>`); a random UUID by default. */
  readonly runId?: string | undefined
}

/** How `program.suspend` saves a run's state. */
export type SuspendOptions = {
  /** The most bytes a saved state may take; a larger one fails the suspend, and the run goes on. */
  readonly maxBytes?: number
}

/** A reusable confined runtime over host globals. */
export type Runtime<R = never> = {
  /** Runs a program to its end. */
  readonly execute: (code: string, options?: ProgramOptions) => Effect.Effect<Result, never, R>
  /** A program ready to run once; nothing runs until `program.run()`. */
  readonly program: (code: string, options?: ProgramOptions) => Program<R>
  /**
   * A suspended run (its `state`, or that state as bytes) as a program to continue in this runtime, which must be the
   * same build with the same host globals. The state is checked when it runs: `run()` fails with a `SnapshotError`
   * when it can't be resumed here.
   */
  readonly resume: (state: Suspended["state"] | Uint8Array) => Program<R, SnapshotError>
}

/**
 * One run of a program. `run()` runs it in the current fiber until it ends or is suspended, and owns its host calls:
 * interrupting `run()` interrupts them. A program runs once: running it again is a defect.
 */
export type Program<R = never, E = never> = {
  readonly run: () => Effect.Effect<Outcome, E, R>
  /**
   * Saves the run's state and stops it, at once, from another fiber: `run()` then returns the same `Suspended`, and so
   * does this. It fails with a `SuspendError`, leaving the run running, while a host call that can't be suspended is
   * in progress, or when the state can't be saved or is over `options.maxBytes`. A run that already ended gives its
   * result. Before `run()` starts, this waits for it to start.
   */
  readonly suspend: (options?: SuspendOptions) => Effect.Effect<Outcome, SuspendError>
}

/** The Effect environment the host functions among `G` need, at any depth. */
export type Services<G> = ServicesOf<G, []>

type ServicesOf<T, Depth extends ReadonlyArray<unknown>> = Depth["length"] extends 8
  ? never
  : T extends Fn<infer R> | DurableFn<infer R> | Namespace<infer R>
    ? R
    : T extends object
      ? ServicesOf<T[keyof T], [...Depth, unknown]>
      : never

/** Creates a runtime whose programs reach `globals`. */
export const make = <const G extends Globals = {}>(options: Options<G> = {}): Runtime<Services<G>> => {
  type R = Services<G>
  const setup: Setup<R> = {
    limits: {
      timeoutMs: validateLimit("timeoutMs", options.limits?.timeoutMs, 1),
      maxOutputBytes: validateLimit("maxOutputBytes", options.limits?.maxOutputBytes, 0),
    },
    globals: options.globals,
    translate: {
      functions: options.translate?.functions ?? "error",
      promises: options.translate?.promises ?? "error",
    },
  }
  const program = (code: string, programOptions?: ProgramOptions) =>
    makeProgram(() => Effect.succeed(startProgram(setup, code, programOptions?.bindings, programOptions?.runId)))
  return {
    execute: (code, programOptions) => Effect.suspend(() => finishExecution(program(code, programOptions).run())),
    program,
    resume: (state) => makeProgram(() => resumeProgram(setup, state)),
  }
}

export const validateLimit = (name: string, value: number | undefined, minimum: number): number | undefined => {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < minimum)) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${minimum}.`)
  }
  return value
}

// A program's one run: `start` makes it when `run()` is called, and a suspend waits for it.
const makeProgram = <R, E>(start: () => Effect.Effect<Running<R>, E>): Program<R, E> => {
  let claimed = false
  const started = Deferred.makeUnsafe<Running<R>, SuspendError>()
  return {
    run: () =>
      Effect.suspend(() => {
        if (claimed) {
          return Effect.die(new Error("A program runs once; make another with runtime.program or runtime.resume."))
        }
        claimed = true
        return start().pipe(
          Effect.onExit((exit) =>
            Exit.isSuccess(exit)
              ? Deferred.succeed(started, exit.value)
              : Deferred.fail(started, new SuspendError({ message: "The program didn't start.", running: [] })),
          ),
          Effect.flatMap((running) => running.run()),
        )
      }),
    suspend: (options) => {
      const maxBytes = options?.maxBytes
      if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes < 0)) {
        throw new RangeError("maxBytes must be a safe integer greater than or equal to 0.")
      }
      return Effect.flatMap(Deferred.await(started), (running) => running.suspend(maxBytes))
    },
  }
}
