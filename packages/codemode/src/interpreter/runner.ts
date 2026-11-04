import { Cause, type Context, Effect, Exit, Fiber } from "effect"
import type { Diagnostic } from "../codemode.js"
import { locate, normalizeError } from "./errors.js"
import type { Interpreter } from "./interpreter.js"
import { MAX_PENDING_PROMISES } from "./limits.js"
import { type AstNode, type GeneratorRequestKind, PendingThrow, rangeError, typeError } from "./model.js"
import { type Callable, type GeneratorObj, get, Obj, PromiseObj, Resolver, type Value } from "./objects.js"
import { react } from "./promises.js"
import { fromJson, type Json } from "../data.js"
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

export type Entry = { readonly body: Eval<unknown>; readonly boundary: Boundary | undefined }

/** Paused or running program code: activations on an explicit stack, innermost last. */
export class Task {
  constructor(readonly stack: Array<Entry>) {}
}

export type Start = { readonly task: Task; readonly input: Completion }

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
 * starts a task. The kinds:
 * - `await`: resume the async body parked on the promise.
 * - `settle`: pass the outcome on to `target`.
 * - `handler`: `then`/`catch` handlers; the handler's result settles `derived`.
 * - `combinator`: one member of a `Promise` combinator.
 * - `finally`, `finallyCleaned`, `finallyOutcome`: the steps of `Promise.prototype.finally` with a cleanup.
 * - `awaitReturn`: an async generator's `return(value)` once `value` settles.
 * - `callback`: a host closure, still used by the async-from-sync iterator adapter.
 */
export type Reaction =
  | { readonly kind: "await"; readonly task: Task }
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
  | { readonly kind: "callback"; readonly run: (settled: Completion) => Start | void }

/** One queued job, as data: run a settled promise's reaction, resume a task, or adopt a thenable. */
export type Job =
  | { readonly kind: "reaction"; readonly reaction: Reaction; readonly settled: Completion }
  | { readonly kind: "resume"; readonly task: Task; readonly input: Completion }
  | { readonly kind: "thenable"; readonly promise: PromiseObj; readonly thenable: Obj; readonly then: Value }

/**
 * Host work the program waits on: a tool or extension call, running as a fiber the runner keeps by `id`. Its outcome
 * arrives as an inbox record and settles the call's promise in a later job.
 */
export class HostCall {
  status: "inFlight" | "completed" = "inFlight"
  constructor(
    readonly id: number,
    /** What runs: a tool path, or an extension function's label. */
    readonly label: string,
    /** A tool's arguments, as they crossed. */
    readonly args: ReadonlyArray<Json | undefined> | undefined,
    /** How the result becomes a program value: a tool's crosses as JSON, an extension's is already one. */
    readonly result: "json" | "value",
    readonly resolving: Resolving,
    /** The call that started the work, where a defect it raises is located. */
    readonly site: AstNode | undefined,
  ) {}
}

/** A host call's outcome, waiting to be delivered. */
type Delivery = { readonly call: HostCall; readonly completion: Completion }

/**
 * CreateResolvingFunctions as data: settles one promise at most once, however many `Resolver`s share it. `reject` takes
 * the failure as thrown; one without a location is located at `site`, the call that created the promise.
 */
export class Resolving {
  done = false
  constructor(
    private readonly runner: Pick<Runner<unknown>, "resolveWith" | "reject">,
    readonly promise: PromiseObj,
    readonly site: AstNode | undefined,
  ) {}

  resolve(resolution: Value): void {
    if (this.done) return
    this.done = true
    this.runner.resolveWith(this.promise, resolution, this.site)
  }

  reject(reason: unknown): void {
    if (this.done) return
    this.done = true
    this.runner.reject(this.promise, locate(reason, this.site))
  }
}

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
  private nextHostID = 0
  /** Rejections nothing handled yet, described when they happened so reporting them at the end is cheap. */
  private readonly unhandled = new Map<PromiseObj, Diagnostic>()
  /** Bodies suspended at an `await` and the promise each waits on, so a stall can point at the one that is stuck. */
  private readonly parked = new Map<Task, { readonly promise: PromiseObj; readonly node: AstNode | undefined }>()
  /** Running host work by `HostCall` id; fibers stay here and never become part of the program's state. */
  private readonly fibers = new Map<number, Fiber.Fiber<unknown, unknown>>()
  private readonly inbox: Array<Delivery> = []
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
            start = self.runJob(job) ?? undefined
            if (start === undefined && self.tick()) yield* self.yieldToHost
            continue
          }
          const delivery = self.inbox.shift()
          if (delivery !== undefined) {
            self.deliver(delivery)
            continue
          }
          if (self.fibers.size > 0) {
            yield* self.hostSettled
            continue
          }
          return abrupt(
            new PendingThrow(
              "Error",
              "The program is waiting on a promise that can never settle: nothing else is running, so nothing can resolve it. Code Mode has no timers or sleep, so don't wait or poll inside a program.",
              self.stuckAwait(),
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
      while (self.fibers.size > 0) yield* Fiber.interruptAll([...self.fibers.values()])
    })
  }

  /**
   * Rejections no handler observed, in the order their promises were created. Host work that finished before the
   * program did settles first, so its failures count even though no later job ran.
   */
  diagnostics(): Array<Diagnostic> {
    for (let delivery = this.inbox.shift(); delivery !== undefined; delivery = this.inbox.shift())
      this.deliver(delivery)
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
   * Starts host work now, settling `resolving`'s promise in a later job, in completion order. A defect is located at
   * `site`, the call that started the work.
   */
  host(
    effect: Effect.Effect<unknown, unknown, R>,
    call: {
      readonly label: string
      readonly args?: ReadonlyArray<Json | undefined>
      readonly result: "json" | "value"
      readonly resolving: Resolving
      readonly site: AstNode | undefined
    },
  ): HostCall {
    const record = new HostCall(this.nextHostID++, call.label, call.args, call.result, call.resolving, call.site)
    // Starts synchronously, so admission and hooks happen at the call site.
    const fiber = Effect.runForkWith(this.services)(effect)
    this.fibers.set(record.id, fiber)
    fiber.addObserver((exit) => {
      this.fibers.delete(record.id)
      // Interrupted by the program ending: nothing is left to settle.
      if (this.stopping) return
      this.inbox.push({
        call: record,
        completion: Exit.isSuccess(exit)
          ? normal(exit.value)
          : abrupt(
              Cause.hasInterruptsOnly(exit.cause)
                ? new Interruption(exit.cause)
                : Cause.hasDies(exit.cause)
                  ? locate(Cause.squash(exit.cause), record.site)
                  : Cause.squash(exit.cause),
            ),
      })
      this.wake?.()
    })
    return record
  }

  private deliver(delivery: Delivery): void {
    const call = delivery.call
    const completion = delivery.completion
    call.status = "completed"
    if (!completion.ok) return call.resolving.reject(completion.error)
    call.resolving.resolve(
      call.result === "json" ? fromJson(this.ctx, completion.value as Json | undefined) : (completion.value as Value),
    )
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

  /** CreateResolvingFunctions for `promise`; a failure without a location is located at `site`. */
  resolving(promise: PromiseObj, site?: AstNode): Resolving {
    return new Resolving(this, promise, site)
  }

  /** PerformPromiseThen with one reaction for either outcome; marks the promise handled. */
  then(promise: PromiseObj, reaction: Reaction): void {
    if (promise.state === "pending") promise.reactions.push(reaction)
    else {
      if (promise.state === "rejected") this.unhandled.delete(promise)
      const settled = promise.state === "fulfilled" ? normal(promise.result) : abrupt(promise.result)
      this.enqueue({ kind: "reaction", reaction, settled })
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

  /** Rejects `promise` with a failure as thrown. */
  reject(promise: PromiseObj, reason: unknown): void {
    this.settle(promise, abrupt(reason))
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
    for (const reaction of reactions) this.enqueue({ kind: "reaction", reaction, settled: completion })
  }

  /** ResolvePromise: adopts a thenable, otherwise fulfills. */
  resolveWith(promise: PromiseObj, resolution: Value, site?: AstNode): void {
    if (resolution === promise) {
      const cycle = typeError("Chaining cycle detected: a promise cannot resolve with itself.", site)
      return this.settle(promise, abrupt(cycle))
    }
    if (!(resolution instanceof Obj)) return this.settle(promise, normal(resolution))
    const then = get(resolution, "then")
    if (typeofValue(then) !== "function") return this.settle(promise, normal(resolution))
    this.enqueue({ kind: "thenable", promise, thenable: resolution, then })
  }

  // NewPromiseResolveThenableJob. Adopting a native promise through the intrinsic `then` takes the same jobs as
  // calling it, and keeps the rejection as thrown so its diagnostic survives.
  private thenableJob(promise: PromiseObj, thenable: Obj, then: Value): Start | void {
    const resolving = this.resolving(promise)
    if (then === this.intrinsicThen && thenable instanceof PromiseObj) {
      this.then(thenable, { kind: "settle", target: resolving })
      return
    }
    const proto = this.ctx.builtins.Function
    const resolve = new Resolver(proto, "", resolving, "resolve")
    const reject = new Resolver(proto, "", resolving, "reject")
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

  private runJob(job: Job): Start | void {
    if (job.kind === "resume") return { task: job.task, input: job.input }
    if (job.kind === "thenable") return this.thenableJob(job.promise, job.thenable, job.then)
    const reaction = job.reaction
    if (reaction.kind !== "await") return react(this.ctx, reaction, job.settled)
    this.parked.delete(reaction.task)
    return { task: reaction.task, input: job.settled }
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
        this.parked.set(continuation, { promise, node: signal.node })
        this.then(promise, { kind: "await", task: continuation })
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

  // The innermost stuck `await`: an outer one waits on the result of a parked async body, so prefer one that does not.
  // Bodies that wait on each other in a cycle leave no such await; any located one is then as good as another.
  private stuckAwait(): AstNode | undefined {
    const results = new Set<Value>()
    for (const task of this.parked.keys()) {
      const boundary = task.stack[0]?.boundary
      if (boundary instanceof AsyncBoundary) results.add(boundary.result)
    }
    const located = [...this.parked.values()].filter((parked) => parked.node !== undefined)
    return (located.find((parked) => !results.has(parked.promise)) ?? located[0])?.node
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
