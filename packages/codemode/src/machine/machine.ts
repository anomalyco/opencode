import type { Diagnostic } from "../codemode.js"
import { fromJson, type Json } from "../data.js"
import { normalizeError } from "../interpreter/errors.js"
import type { Interpreter } from "../interpreter/interpreter.js"
import { MAX_PENDING_PROMISES } from "../interpreter/limits.js"
import { type AstNode, rangeError, typeError } from "../interpreter/model.js"
import { type Callable, get, Obj, PromiseObj, type Value } from "../interpreter/objects.js"
import { adoptThenable, type JobFrame, react } from "../interpreter/promises.js"
import { typeofValue } from "../interpreter/references.js"
import { ScopeStack } from "../interpreter/scope.js"
import { abrupt, Await, type Completion, Host, Interruption, normal, Slice, Yield } from "../interpreter/signals.js"
import type { Source } from "../interpreter/source.js"
import { Frame } from "./frame.js"
import { adapterSettled } from "./generators.js"
import { HostCall, type HostRequest, type Job, type Reaction, Resolving, type Stop } from "./scheduler.js"
import { ProgramKind } from "./statements.js"
import { MachineTask } from "./task.js"

/** Interpreter steps between clock checks, and how long one slice may run before the host gets a turn. */
const FUEL = 64
const SLICE_MS = 1

/** A host call's outcome, waiting to be delivered. */
type Delivery = { readonly call: HostCall; readonly completion: Completion }

/** Frames parked on a promise at an `await`, and what the frame below their boundary received when they were cut. */
type Parked = { readonly promise: PromiseObj; readonly node: AstNode | undefined; readonly result: Value }

/**
 * One execution's machine: program code runs as explicit frames on a stack, stepped by a loop, and the job queue,
 * promises, and host calls it waits on are data it keeps. Program code runs only inside a job, one job at a time and
 * each to completion, as in a JavaScript engine: promise reactions and resumed awaits queue in order, host work runs
 * outside and settles its promise as a later job, and the program is stuck exactly when no job is queued and no host
 * work is running.
 *
 * `run` steps until the machine has to stop, and says why (`Stop`); the driver (`driver.ts`) does what the stop asks
 * and calls `run` again. Nothing here runs host work or knows about Effect.
 */
export class Machine {
  /** Activations on the stack that count toward the call-depth limit. */
  depth = 0
  /** The intrinsic `Promise.prototype.then`, so adopting a native promise skips exposing its rejection first. */
  intrinsicThen: Callable | undefined
  /** The stack every job runs on. */
  readonly root: MachineTask
  /** How the program's body ended, once it has. */
  outcome: Completion | undefined
  /** Frames suspended at an `await`, by the slice cut off the stack, so a stall can point at the one that is stuck. */
  readonly parked = new Map<Array<Frame>, Parked>()

  private readonly queue: Array<Job> = []
  private head = 0
  private fuel = FUEL
  private sliceStart = 0
  private pending = 0
  private nextID = 0
  private nextHostID = 0
  /** Rejections nothing handled yet, described when they happened so reporting them at the end is cheap. */
  private readonly unhandled = new Map<PromiseObj, Diagnostic>()
  /** Host calls queued since the last stop, for the driver to start. */
  private queued: Array<HostCall> = []
  /** Host calls the driver is running, by id. */
  private readonly running = new Map<number, HostCall>()
  private readonly inbox: Array<Delivery> = []
  /** What the root stack continues with: the job in progress was paused, or has just started. */
  private input: Completion | undefined
  /** A slice is due once the queued host calls are handed over. */
  private sliced = false

  constructor(readonly ctx: Interpreter<unknown>) {
    this.root = new MachineTask(this, new ScopeStack([]))
  }

  /** Queues the program's body as the first job. */
  start(source: Source): void {
    this.root.enter([new Frame(ProgramKind, source.program, 0, this.ctx.programScopes(), [])])
    this.input = normal(undefined)
  }

  /** Steps until the machine has to stop: see `Stop`. A throw no frame handles escapes as a defect. */
  run(): Stop {
    this.sliceStart = performance.now()
    while (true) {
      if (this.queued.length > 0) {
        const calls = this.queued
        this.queued = []
        for (const call of calls) {
          call.status = "inFlight"
          this.running.set(call.id, call)
        }
        return { kind: "host", calls }
      }
      if (this.sliced) {
        this.sliced = false
        return { kind: "slice" }
      }
      const input = this.input
      if (input !== undefined) {
        this.input = undefined
        this.continue(input)
        continue
      }
      // A blocking call is running: the job that made it continues once it completes.
      if (this.root.stack.length > 0) return { kind: "host", calls: [] }
      if (this.outcome !== undefined) return { kind: "done", completion: this.outcome }
      const job = this.dequeue()
      if (job !== undefined) {
        this.begin(job)
        if (this.input === undefined && this.tick()) this.sliced = true
        continue
      }
      const delivery = this.inbox.shift()
      if (delivery !== undefined) {
        this.deliver(delivery)
        continue
      }
      if (this.running.size > 0) return { kind: "host", calls: [] }
      return { kind: "stuck", node: this.stuckAwait() }
    }
  }

  /**
   * Reports how host work handed over by a stop ended. A blocking call's outcome continues the job that made it; a
   * concurrent call's waits in the inbox and settles its promise in a later job, in completion order.
   */
  complete(id: number, completion: Completion): void {
    const call = this.running.get(id)
    if (call === undefined) return
    this.running.delete(id)
    if (call.blocking) {
      call.status = "completed"
      this.input = completion
      return
    }
    this.inbox.push({ call, completion })
  }

  /** Whether a host call's outcome is waiting to be delivered. */
  get ready(): boolean {
    return this.inbox.length > 0 || this.input !== undefined
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

  /** Counts one interpreter step; true when the slice is over and the host should get a turn. */
  tick(): boolean {
    if (--this.fuel > 0) return false
    this.fuel = FUEL
    return performance.now() - this.sliceStart >= SLICE_MS
  }

  enqueue(job: Job): void {
    this.queue.push(job)
  }

  /**
   * Queues concurrent host work, settling `resolving`'s promise in a later job, in completion order. The driver starts
   * it at the next stop, before any other job runs. A defect is located at `site`, the call that started the work.
   */
  host(
    request: HostRequest,
    call: {
      readonly label: string
      readonly result: "json" | "value"
      readonly resolving: Resolving
      readonly site: AstNode | undefined
    },
  ): HostCall {
    const record = new HostCall(this.nextHostID++, request, call.label, false, call.result, call.resolving, call.site)
    this.queued.push(record)
    return record
  }

  /** Parks frames cut off the stack at an `await` on the awaited promise; they resume as a job once it settles. */
  park(frames: Array<Frame>, promise: PromiseObj, node: AstNode | undefined, result: Value): void {
    this.parked.set(frames, { promise, node, result })
    this.then(promise, { kind: "await", frames })
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

  // --- Jobs ---

  // Starts a job on the root stack: parked frames resume with how their promise settled, an async-from-sync iterator
  // closing its iterator runs as a frame, and a reaction or thenable that calls program code runs its work in a native
  // frame. One that finishes at once leaves the stack empty.
  private begin(job: Job): void {
    if (job.kind === "thenable") return this.work(adoptThenable(this.ctx, job.promise, job.thenable, job.then))
    const reaction = job.reaction
    if (reaction.kind === "asyncFromSync") {
      const frame = adapterSettled(this.ctx, reaction, job.settled, this.root.scopes)
      if (frame !== undefined) this.resume([frame], normal(undefined))
      return
    }
    if (reaction.kind !== "await") return this.work(react(this.ctx, reaction, job.settled))
    this.parked.delete(reaction.frames)
    this.resume(reaction.frames, job.settled)
  }

  private resume(frames: Array<Frame>, input: Completion): void {
    this.root.enter(frames)
    this.input = input
  }

  private work(job: JobFrame | void): void {
    if (job === undefined) return
    this.resume([new Frame(job.kind, undefined, 0, this.root.scopes, job.slots)], normal(undefined))
  }

  // Continues the job on the root stack. It ends when the stack empties, or pauses for a slice or a blocking host call;
  // either way it continues before any other job.
  private continue(input: Completion): void {
    const root = this.root
    const result = root.drive(input.ok, input.ok ? input.value : input.error)
    if (result.done) {
      if (this.tick()) this.sliced = true
      return
    }
    const signal = result.value
    if (signal === Slice) {
      this.input = normal(undefined)
      this.sliced = true
      return
    }
    if (signal instanceof Host) {
      const call = new HostCall(
        this.nextHostID++,
        signal.request,
        signal.request.kind,
        true,
        "value",
        undefined,
        undefined,
      )
      this.queued.push(call)
      return
    }
    // Nothing on the stack can take an `await` or `yield`: the frame that asked receives the failure.
    if (signal instanceof Await) this.input = abrupt(typeError("await is only valid in async functions."))
    else if (signal instanceof Yield) this.input = abrupt(typeError("yield is only valid inside a generator."))
    else this.input = abrupt(new TypeError("The machine cannot answer this signal here."))
  }

  private deliver(delivery: Delivery): void {
    const call = delivery.call
    const completion = delivery.completion
    call.status = "completed"
    const resolving = call.resolving!
    if (!completion.ok) return resolving.reject(completion.error)
    resolving.resolve(
      call.result === "json" ? fromJson(this.ctx, completion.value as Json | undefined) : (completion.value as Value),
    )
  }

  // The innermost stuck `await`: an outer one waits on the result of a parked async body, so prefer one that does not.
  // Bodies that wait on each other in a cycle leave no such await; any located one is then as good as another.
  private stuckAwait(): AstNode | undefined {
    const results = new Set<Value>()
    for (const parked of this.parked.values()) if (parked.result instanceof PromiseObj) results.add(parked.result)
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
}
