import { Cause, type Context, Effect, Exit, Fiber } from "effect"
import type { Diagnostic } from "../codemode.js"
import { locate, normalizeError } from "./errors.js"
import type { Interpreter } from "./interpreter.js"
import { MAX_PENDING_PROMISES } from "./limits.js"
import { type AstNode, type GeneratorRequestKind, rangeError, Throw, typeError } from "./model.js"
import { fn } from "./native.js"
import { type Callable, get, Obj, PromiseObj, type Value } from "./objects.js"
import { typeofValue } from "./references.js"

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

/** Run `body` as a new activation; a boundary marks where a suspended body splits off the stack. */
export class Call {
  constructor(
    readonly body: Eval<unknown>,
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

/** Suspend the innermost async body until `value` settles. */
export class Await {
  constructor(readonly value: Value) {}
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

export type Signal = Call | Enter | Await | Yield | Host | typeof Slice

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
    private readonly result: Value,
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

export type Entry = { readonly body: Eval<unknown>; readonly boundary: Boundary | undefined }

/** Paused or running program code: activations on an explicit stack, innermost last. */
export class Task {
  constructor(readonly stack: Array<Entry>) {}
}

/** A settled promise's reaction, run as a job: it either finishes at once or starts a task. */
export type Reaction = (settled: Completion) => Start | void

export type Start = { readonly task: Task; readonly input: Completion }

/** The functions that settle one promise, at most once between them. */
export type Resolving = { readonly resolve: (resolution: Value) => void; readonly reject: (reason: unknown) => void }

type Job = () => Start | void

type Pause =
  | { readonly kind: "slice"; readonly input: Completion }
  | { readonly kind: "host"; readonly effect: Effect.Effect<unknown, unknown> }

/** Most activations one task may hold, as the call-stack limit. */
export const MAX_CALL_DEPTH = 10_000
/** Interpreter steps between clock checks, and how long one slice may run before the host gets a turn. */
const FUEL = 64
const SLICE_MS = 1

// Program values never have a `next` method of their own: an object's properties live in its property map.
export const isEval = <A>(value: A | Eval<A>): value is Eval<A> =>
  typeof value === "object" && value !== null && typeof (value as { readonly next?: unknown }).next === "function"

/**
 * One execution's job queue. Program code runs only inside a job, one job at a time and each to completion, as in a
 * JavaScript engine: promise reactions and resumed awaits queue in order, host work runs concurrently and settles its
 * promise as a later job, and the program is stuck exactly when no job is queued and no host work is running.
 */
export class Runner<R> {
  /** The intrinsic `Promise.prototype.then`, so adopting a native promise skips exposing its rejection first. */
  intrinsicThen: Callable | undefined
  private readonly queue: Array<Job> = []
  private head = 0
  private current: Task | undefined
  private fuel = FUEL
  private sliceStart = 0
  private pending = 0
  private nextID = 0
  /** Rejections nothing handled yet, described when they happened so reporting them at the end is cheap. */
  private readonly unhandled = new Map<PromiseObj, Diagnostic>()
  private readonly fibers = new Set<Fiber.Fiber<unknown, unknown>>()
  private readonly inbox: Array<() => void> = []
  private wake: (() => void) | undefined
  private stopping = false

  constructor(
    private readonly ctx: Interpreter<R>,
    /** The services host work runs with: the caller's, so tools see its context, tracing, and clock. */
    private readonly services: Context.Context<R>,
  ) {}

  /** Activations on the running task's stack. */
  get depth(): number {
    return this.current?.stack.length ?? 0
  }

  /**
   * Runs the program as the first job until its body completes, then returns how it ended. Host work it started may
   * still be running; `interrupt` stops it.
   */
  run(main: Eval<unknown>): Effect.Effect<Completion, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      let outcome: Completion | undefined
      let start: Start | undefined = {
        task: new Task([
          {
            body: main,
            boundary: new AsyncBoundary((completion) => {
              outcome = completion
            }, undefined),
          },
        ]),
        input: normal(undefined),
      }
      self.sliceStart = performance.now()
      while (outcome === undefined) {
        if (start === undefined) {
          const job = self.dequeue()
          if (job !== undefined) {
            start = job() ?? undefined
            if (start === undefined && self.tick()) yield* self.yieldToHost
            continue
          }
          const settle = self.inbox.shift()
          if (settle !== undefined) {
            settle()
            continue
          }
          if (self.fibers.size > 0) {
            yield* self.hostSettled
            continue
          }
          return abrupt(
            new Error(
              "Execution stalled: the program is waiting for a promise that nothing can settle (no job is queued and no tool call is running).",
            ),
          )
        }
        const pause = self.drive(start.task, start.input)
        if (pause === undefined) {
          start = undefined
          if (self.tick()) yield* self.yieldToHost
          continue
        }
        if (pause.kind === "slice") {
          start = { task: start.task, input: pause.input }
          yield* self.yieldToHost
          continue
        }
        const exit = yield* Effect.exit(pause.effect)
        if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
        start = {
          task: start.task,
          input: Exit.isSuccess(exit) ? normal(exit.value) : abrupt(Cause.squash(exit.cause)),
        }
      }
      if (!outcome.ok && outcome.error instanceof Interruption) return yield* Effect.failCause(outcome.error.cause)
      return outcome
    })
  }

  /** Stops host work still running, waiting for its cleanup. */
  interrupt(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      self.stopping = true
      while (self.fibers.size > 0) yield* Fiber.interruptAll([...self.fibers])
    })
  }

  /**
   * Rejections no handler observed, in the order their promises were created. Host work that finished before the
   * program did settles first, so its failures count even though no later job ran.
   */
  diagnostics(): Array<Diagnostic> {
    for (let settle = this.inbox.shift(); settle !== undefined; settle = this.inbox.shift()) settle()
    return [...this.unhandled].sort(([left], [right]) => left.id - right.id).map(([, diagnostic]) => diagnostic)
  }

  /** Counts one interpreter step; true when the slice is over and the caller should yield `Slice`. */
  tick(): boolean {
    if (--this.fuel > 0) return false
    this.fuel = FUEL
    return performance.now() - this.sliceStart >= SLICE_MS
  }

  /** A blocking host call, with the caller's services provided so the runner can run it as is. */
  blocking<A, E>(effect: Effect.Effect<A, E, R>): Host {
    return new Host(Effect.provideContext(effect, this.services))
  }

  enqueue(job: Job): void {
    this.queue.push(job)
  }

  /**
   * Starts host work now; its completion settles through `settle` in a later job, in completion order. A defect is
   * located at `site`, the call that started the work.
   */
  host(effect: Effect.Effect<unknown, unknown, R>, settle: (completion: Completion) => void, site?: AstNode): void {
    // Starts synchronously, so admission and hooks happen at the call site.
    const fiber = Effect.runForkWith(this.services)(effect)
    this.fibers.add(fiber)
    fiber.addObserver((exit) => {
      this.fibers.delete(fiber)
      // Interrupted by the program ending: nothing is left to settle.
      if (this.stopping) return
      this.inbox.push(() =>
        settle(
          Exit.isSuccess(exit)
            ? normal(exit.value)
            : abrupt(
                Cause.hasInterruptsOnly(exit.cause)
                  ? new Interruption(exit.cause)
                  : Cause.hasDies(exit.cause)
                    ? locate(Cause.squash(exit.cause), site)
                    : Cause.squash(exit.cause),
              ),
        ),
      )
      this.wake?.()
    })
  }

  // --- Promise abstract operations ---

  newPromise(): PromiseObj {
    if (this.pending >= MAX_PENDING_PROMISES) {
      throw rangeError(
        `Too many pending promises (limit ${MAX_PENDING_PROMISES}); await promises before creating more.`,
      )
    }
    this.pending++
    return new PromiseObj(this.ctx.builtins.Promise, this.nextID++)
  }

  /**
   * CreateResolvingFunctions, for host callers; `reject` takes the failure as thrown. A failure without a location is
   * located at `site`, the call that created the promise.
   */
  resolving(promise: PromiseObj, site?: AstNode): Resolving {
    let done = false
    return {
      resolve: (resolution) => {
        if (done) return
        done = true
        this.resolveWith(promise, resolution, site)
      },
      reject: (reason) => {
        if (done) return
        done = true
        this.settle(promise, abrupt(locate(reason, site)))
      },
    }
  }

  /** PerformPromiseThen with one reaction for either outcome; marks the promise handled. */
  then(promise: PromiseObj, reaction: Reaction): void {
    if (promise.state === "pending") promise.reactions.push(reaction)
    else {
      if (promise.state === "rejected") this.unhandled.delete(promise)
      const settled = promise.state === "fulfilled" ? normal(promise.result) : abrupt(promise.result)
      this.enqueue(() => reaction(settled))
    }
    promise.handled = true
  }

  /** Removes a reaction an internal consumer no longer needs, so a long-pending promise does not keep it. */
  detach(promise: PromiseObj, reaction: Reaction): void {
    const index = promise.reactions.indexOf(reaction)
    if (index >= 0) promise.reactions.splice(index, 1)
  }

  /** PromiseResolve(%Promise%, value). */
  promiseResolve(value: Value): PromiseObj {
    if (value instanceof PromiseObj) return value
    const promise = this.newPromise()
    this.resolveWith(promise, value)
    return promise
  }

  private settle(promise: PromiseObj, completion: Completion): void {
    if (promise.state !== "pending") return
    this.pending--
    promise.state = completion.ok ? "fulfilled" : "rejected"
    promise.result = completion.ok ? completion.value : completion.error
    const reactions = promise.reactions
    promise.reactions = []
    if (!completion.ok && !promise.handled && !(completion.error instanceof Interruption)) {
      const failure = normalizeError(completion.error)
      this.unhandled.set(promise, {
        ...failure,
        message: `Unhandled rejection from an un-awaited promise: ${failure.message}`,
      })
    }
    for (const reaction of reactions) this.enqueue(() => reaction(completion))
  }

  private resolveWith(promise: PromiseObj, resolution: Value, site?: AstNode): void {
    if (resolution === promise) {
      const cycle = typeError("Chaining cycle detected: a promise cannot resolve with itself.", site)
      return this.settle(promise, abrupt(cycle))
    }
    if (!(resolution instanceof Obj)) return this.settle(promise, normal(resolution))
    const then = get(resolution, "then")
    if (typeofValue(then) !== "function") return this.settle(promise, normal(resolution))
    this.enqueue(() => this.thenableJob(promise, resolution, then))
  }

  // NewPromiseResolveThenableJob. Adopting a native promise through the intrinsic `then` takes the same jobs as
  // calling it, and keeps the rejection as thrown so its diagnostic survives.
  private thenableJob(promise: PromiseObj, thenable: Obj, then: Value): Start | void {
    const resolving = this.resolving(promise)
    if (then === this.intrinsicThen && thenable instanceof PromiseObj) {
      this.then(thenable, (settled) =>
        settled.ok ? resolving.resolve(settled.value as Value) : resolving.reject(settled.error),
      )
      return
    }
    const builtins = this.ctx.builtins
    const resolve = fn(builtins, "", 1, (_, args) => {
      resolving.resolve(args[0])
      return undefined
    })
    const reject = fn(builtins, "", 1, (_, args) => {
      resolving.reject(new Throw(args[0]))
      return undefined
    })
    const ctx = this.ctx
    const body = function* (): Eval<void> {
      try {
        yield* ctx.call(then, thenable, [resolve, reject])
      } catch (error) {
        resolving.reject(error)
      }
    }
    return { task: new Task([{ body: body(), boundary: undefined }]), input: normal(undefined) }
  }

  // --- Driver ---

  // Runs a task until its stack empties or it pauses for a slice or host work, which resumes it before any other job.
  private drive(task: Task, input: Completion): Pause | undefined {
    const stack = task.stack
    this.current = task
    let completion = input
    while (stack.length > 0) {
      const entry = stack[stack.length - 1]!
      let step: IteratorResult<Signal, unknown>
      try {
        step = completion.ok ? entry.body.next(completion.value) : entry.body.throw(completion.error)
      } catch (error) {
        stack.pop()
        completion = entry.boundary === undefined ? abrupt(error) : entry.boundary.finish(abrupt(error))
        continue
      }
      if (step.done) {
        stack.pop()
        completion = entry.boundary === undefined ? normal(step.value) : entry.boundary.finish(normal(step.value))
        continue
      }
      const signal = step.value
      if (signal instanceof Call) {
        stack.push({ body: signal.body, boundary: signal.boundary })
        completion = normal(undefined)
        if (this.tick()) return { kind: "slice", input: completion }
        continue
      }
      if (signal instanceof Enter) {
        for (const saved of signal.entries) stack.push(saved)
        completion = signal.input
        if (this.tick()) return { kind: "slice", input: completion }
        continue
      }
      if (signal instanceof Await) {
        const index = stack.findLastIndex((item) => item.boundary?.async === true)
        if (index < 0) {
          completion = abrupt(typeError("await is only valid in async functions."))
          continue
        }
        let promise: PromiseObj
        try {
          promise = this.promiseResolve(signal.value)
        } catch (error) {
          completion = abrupt(error)
          continue
        }
        const boundary = stack[index]!.boundary!
        const continuation = new Task(stack.splice(index))
        this.then(promise, (settled) => ({ task: continuation, input: settled }))
        completion = boundary.suspended()
        continue
      }
      if (signal instanceof Yield) {
        const index = stack.findLastIndex((item) => item.boundary?.generator === true)
        if (index < 0) {
          completion = abrupt(typeError("yield is only valid inside a generator."))
          continue
        }
        completion = stack[index]!.boundary!.yielded(signal.value, () => stack.splice(index))
        continue
      }
      if (signal instanceof Host) return { kind: "host", effect: signal.effect }
      return { kind: "slice", input: normal(undefined) }
    }
    this.current = undefined
    if (!completion.ok) throw completion.error
    return undefined
  }

  private dequeue(): Job | undefined {
    if (this.head === this.queue.length) {
      if (this.head > 0) {
        this.queue.length = 0
        this.head = 0
      }
      return undefined
    }
    const job = this.queue[this.head++]
    if (this.head > 4096 && this.head * 2 > this.queue.length) {
      this.queue.splice(0, this.head)
      this.head = 0
    }
    return job
  }

  private get yieldToHost(): Effect.Effect<void> {
    return Effect.map(Effect.yieldNow, () => {
      this.sliceStart = performance.now()
    })
  }

  private get hostSettled(): Effect.Effect<void> {
    return Effect.callback<void>((resume) => {
      if (this.inbox.length > 0) return resume(Effect.void)
      this.wake = () => {
        this.wake = undefined
        resume(Effect.void)
      }
      return Effect.sync(() => {
        this.wake = undefined
      })
    })
  }
}
