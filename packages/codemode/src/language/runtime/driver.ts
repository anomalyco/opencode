import { Cause, type Context, Effect, Exit, Fiber } from "effect"
import type { Json } from "../data.js"
import { DurableFn, type Fn } from "../host-function.js"
import type { HostCall } from "../scheduler.js"
import { locate } from "./errors.js"
import { HostFailure, PendingThrow } from "./model.js"
import type { Vm } from "../vm.js"
import { abrupt, type Completion, Interruption, normal } from "./signals.js"

/** What `Driver.run` returns once the run was suspended: its state is saved, and the VM stopped. */
export const SUSPENDED: unique symbol = Symbol("codemode.suspended")

/** For tests: `onPark` is called each time a run has nothing to do but wait on host calls in flight. */
export const parking: { onPark?: () => void } = {}

/**
 * Runs the VM (see `Vm`) in Effect: the only place program execution meets the host. It calls `vm.run`
 * until the program ends, and does what each stop asks: yields to the Effect scheduler for a slice, and starts the host
 * calls the VM queued, as fibers with the caller's services, reporting each outcome back with `vm.complete`.
 * Fibers live only here, by host call id, and never become part of the VM's state.
 *
 * A durable call runs as two fibers, `start` then `wait`, so suspending can detach the second and keep the JSON data
 * `start` gave. An idempotent call's running fiber is detached and interrupted on suspend, and the call is saved as
 * queued to run again on resume. The VM can be swapped for a restored one between stops (the round-trip test mode
 * does); a fiber's outcome goes to whichever VM is current, by host call id.
 */
export class Driver<R> {
  private readonly fibers = new Map<number, Fiber.Fiber<unknown, unknown>>()
  // Calls whose fibers were interrupted to suspend or end the run: their outcomes are not reported.
  private readonly detached = new Set<number>()
  private wake: (() => void) | undefined
  private stopping = false
  private suspending = false
  // Blocking host work interrupted on its own, which interrupts the execution.
  private interrupted: Cause.Cause<unknown> | undefined
  /** Called at every slice and host stop, before queued calls start: the round-trip test mode swaps the VM. */
  checkpoint: Effect.Effect<void, unknown, R> | undefined

  constructor(
    public vm: Vm,
    /** The services host work runs with: the caller's, so host functions see its context, tracing, and clock. */
    private readonly services: Context.Context<R>,
  ) {}

  /**
   * Runs the VM until the program's body completes, then returns how it ended, or `SUSPENDED` once the run was
   * suspended (see `detach`). Host work it started may still be running; `interrupt` stops it. Host work interrupted
   * on its own that reaches the program's body, or blocking host work that is interrupted, interrupts the execution.
   */
  run(): Effect.Effect<Completion | typeof SUSPENDED, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      while (true) {
        if (self.interrupted !== undefined) return yield* Effect.failCause(self.interrupted)
        if (self.suspending) return SUSPENDED
        const stop = self.vm.run()
        if (stop.kind === "slice") {
          if (self.checkpoint !== undefined) yield* self.checkpoint
          yield* Effect.yieldNow
          continue
        }
        if (stop.kind === "host") {
          if (stop.calls.length === 0) {
            parking.onPark?.()
            yield* self.settled
            continue
          }
          if (self.checkpoint !== undefined) yield* self.checkpoint
          // Suspended now: the calls stay queued, and start on resume.
          if (self.suspending) continue
          for (const handed of stop.calls) self.launch(self.vm.call(handed.id) ?? handed)
          continue
        }
        if (stop.kind === "stuck") {
          return abrupt(
            new PendingThrow(
              "Error",
              "The program is waiting on a promise that can never settle: nothing else is running, so nothing can resolve it. There are no timers or sleep, so don't wait or poll inside a program.",
              stop.node,
            ),
          )
        }
        const outcome = stop.completion
        if (!outcome.ok && outcome.error instanceof Interruption) return yield* Effect.failCause(outcome.error.cause)
        return outcome
      }
    })
  }

  /**
   * The host calls that block a suspend now: every call in progress except an idempotent call, or a durable call in
   * `started`. A call queued but not started starts on resume, unless its arguments hold host functions, which
   * can't be saved.
   */
  blocking(): Array<{ readonly key: string; readonly path: string }> {
    return this.vm
      .calls()
      .filter(
        (call) =>
          call.holdsFunctions ||
          (call.status !== "queued" && call.status !== "started" && call.policy !== "idempotent"),
      )
      .map((call) => ({ key: call.key, path: call.label }))
  }

  /**
   * Whether the run holds live host values: a call whose function can't be found again, that waits on its result, or
   * whose arguments hold host functions.
   */
  get holdsHostValues(): boolean {
    return this.vm.calls().some((call) => call.work !== undefined || call.path === undefined || call.holdsFunctions)
  }

  /**
   * Stops the run to suspend it, once its state is saved: `run` returns `SUSPENDED` at its next step, and running
   * idempotent or durable calls' fibers are detached, so ending them reports nothing.
   */
  detach(): void {
    this.suspending = true
    for (const id of this.fibers.keys()) this.detached.add(id)
    this.wake?.()
  }

  /** Stops host work still running, waiting for its cleanup; a durable call's work is cancelled unless detached. */
  interrupt(): Effect.Effect<void> {
    const self = this
    return Effect.uninterruptible(
      Effect.gen(function* () {
        self.stopping = true
        while (self.fibers.size > 0) yield* Fiber.interruptAll([...self.fibers.values()])
        // A suspended run's durable work keeps running, to be waited on at resume.
        if (self.suspending) return
        for (const call of self.vm.calls()) {
          if (call.status !== "started") continue
          call.status = "completed"
          const fn = self.function(call)
          if (!(fn instanceof DurableFn)) continue
          const cancel = Effect.suspend(() => fn.cancel(call.data as Json, self.context(call)))
          yield* Effect.ignore(cancel as Effect.Effect<void, unknown, R>).pipe(Effect.provideContext(self.services))
        }
      }),
    )
  }

  /** Starts calls that were queued (including idempotent ones) and waits on durable calls in `started`. */
  resume(): void {
    if (this.suspending) return
    for (const call of this.vm.calls()) {
      if (call.status === "queued") this.launch(call)
      else if (call.status === "started") this.wait(call)
    }
  }

  // Starts host work now; its outcome goes back to the VM: a blocking call's continues the job that made it, a
  // concurrent call's waits in the inbox and settles its promise in a later job, in completion order.
  private launch(call: HostCall): void {
    call.status = "running"
    if (call.work !== undefined) return this.fork(call.id, outcome(call.work))
    const fn = this.function(call)
    if (fn === undefined) {
      return this.fork(
        call.id,
        Effect.fail(new HostFailure("ExecutionFailure", `${call.label} is not available in this runtime.`)),
      )
    }
    if (fn instanceof DurableFn) {
      return this.fork(
        call.id,
        Effect.suspend(() => fn.start(call.args, this.context(call))),
        (data) => {
          const current = this.vm.call(call.id)
          if (current === undefined) return
          current.status = "started"
          current.data = data as Json
          if (this.stopping || this.detached.has(call.id)) return
          this.wait(current)
        },
      )
    }
    this.fork(
      call.id,
      Effect.suspend(() => {
        try {
          return outcome(fn.run(call.args, this.context(call)))
        } catch (reason) {
          return Effect.fail(reason)
        }
      }),
    )
  }

  private wait(call: HostCall): void {
    const fn = this.function(call)
    if (!(fn instanceof DurableFn)) return
    this.fork(
      call.id,
      Effect.suspend(() => fn.wait(call.data as Json, this.context(call))),
    )
  }

  // The call's host function: the one it was made with, or, in a restored run, the one at its path now.
  private function(call: HostCall): Fn<unknown> | DurableFn<unknown> | undefined {
    if (call.fn !== undefined) return call.fn
    if (call.path === undefined) return undefined
    return (call.fn = this.vm.ctx.hosts?.resolve(call.path))
  }

  private context(call: HostCall) {
    return { key: call.key, args: call.args, suspending: () => this.suspending }
  }

  // Forks `work` with the caller's services; it starts synchronously, so host functions run before the VM runs
  // another job. A success goes to `next` when given, otherwise to the VM.
  private fork(id: number, work: Effect.Effect<unknown, unknown, unknown>, next?: (value: unknown) => void): void {
    const fiber = Effect.runForkWith(this.services)(work as Effect.Effect<unknown, unknown, R>)
    this.fibers.set(id, fiber)
    fiber.addObserver((exit) => {
      if (this.fibers.get(id) === fiber) this.fibers.delete(id)
      if (next !== undefined && Exit.isSuccess(exit)) return next(exit.value)
      // Interrupted to end or suspend the run: nothing is left to settle.
      if (this.stopping || this.detached.has(id)) return
      const call = this.vm.call(id)
      if (call === undefined) return
      if (call.blocking && Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
        // Blocking work interrupted on its own interrupts the execution.
        this.interrupted = exit.cause
        this.wake?.()
        return
      }
      this.vm.complete(
        id,
        Exit.isSuccess(exit)
          ? normal(exit.value)
          : abrupt(
              Cause.hasInterruptsOnly(exit.cause)
                ? new Interruption(exit.cause)
                : Cause.hasDies(exit.cause)
                  ? locate(Cause.squash(exit.cause), call.site)
                  : Cause.squash(exit.cause),
            ),
      )
      this.wake?.()
    })
  }

  private get settled(): Effect.Effect<void> {
    return Effect.callback<void>((resume) => {
      if (this.vm.ready || this.suspending || this.interrupted !== undefined) return resume(Effect.void)
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

// What a host function returned, as the Effect its call waits on: an Effect runs, a Promise settles.
const outcome = (result: unknown): Effect.Effect<unknown, unknown, unknown> => {
  if (Effect.isEffect(result)) return result as Effect.Effect<unknown, unknown, unknown>
  if (result instanceof Promise) return Effect.tryPromise({ try: () => result, catch: (reason) => reason })
  return Effect.succeed(result)
}
