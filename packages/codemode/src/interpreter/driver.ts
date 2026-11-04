import { Cause, type Context, Effect, Exit, Fiber } from "effect"
import type { Json } from "../data.js"
import type { Machine } from "../machine/machine.js"
import type { HostCall } from "../machine/scheduler.js"
import type { ToolRuntime } from "../tool-runtime.js"
import { toolError } from "../tool-error.js"
import { locate } from "./errors.js"
import { lostError, PendingThrow } from "./model.js"
import { abrupt, type Completion, Interruption, normal } from "./signals.js"

/** What `Driver.run` returns when a suspend was asked for: the machine stopped at a step boundary. */
export const SUSPENDED: unique symbol = Symbol("codemode.suspended")

/** An outcome the host already knows for a pending call, by its key, handed to a resumed run. */
export type Outcome = { readonly ok: true; readonly value: Json } | { readonly ok: false; readonly error: string }

/**
 * Runs a machine in Effect: the only place program execution meets the host. It calls `machine.run` until the program
 * ends, and does what each stop asks: yields to the Effect scheduler for a slice, and starts the host calls the machine
 * queued, as fibers with the caller's services, reporting each outcome back with `machine.complete`. Fibers live only
 * here, by host call id, and never become part of the machine's state.
 *
 * A durable tool's call runs as two fibers, `start` then `attach`, so suspending can detach the second and keep the
 * handle `start` gave. The machine and tool bridge can be swapped for restored ones between stops (the round-trip test
 * mode does); a fiber's outcome goes to whichever machine is current, by host call id.
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
  /** Called at every slice and host stop, before queued calls start: the round-trip test mode swaps the machine. */
  checkpoint: Effect.Effect<void, unknown, R> | undefined

  constructor(
    public machine: Machine,
    public tools: ToolRuntime<R>,
    /** The services host work runs with: the caller's, so tools see its context, tracing, and clock. */
    private readonly services: Context.Context<R>,
  ) {}

  /**
   * Runs the machine until the program's body completes, then returns how it ended, or `SUSPENDED` once a suspend
   * was asked for. Host work it started may still be running; `interrupt` stops it, `detach` settles it to suspend.
   * Host work interrupted on its own that reaches the program's body, or blocking host work that is interrupted,
   * interrupts the execution.
   */
  run(): Effect.Effect<Completion | typeof SUSPENDED, unknown, R> {
    const self = this
    return Effect.gen(function* () {
      while (true) {
        if (self.interrupted !== undefined) return yield* Effect.failCause(self.interrupted)
        if (self.suspending) return SUSPENDED
        const stop = self.machine.run()
        if (stop.kind === "slice") {
          if (self.checkpoint !== undefined) yield* self.checkpoint
          yield* Effect.yieldNow
          continue
        }
        if (stop.kind === "host") {
          if (stop.calls.length === 0) {
            yield* self.settled
            continue
          }
          if (self.checkpoint !== undefined) yield* self.checkpoint
          // Suspending now leaves the calls queued: none of them has started.
          if (self.suspending) continue
          for (const handed of stop.calls) self.launch(self.machine.call(handed.id) ?? handed)
          continue
        }
        if (stop.kind === "stuck") {
          return abrupt(
            new PendingThrow(
              "Error",
              "The program is waiting on a promise that can never settle: nothing else is running, so nothing can resolve it. Code Mode has no timers or sleep, so don't wait or poll inside a program.",
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

  /** Asks `run` to stop at the next step boundary, waking it if it waits on host work. */
  suspend(): void {
    this.suspending = true
    this.wake?.()
  }

  /**
   * Settles running host work to suspend: waits up to `graceMs` for calls that are not detachable yet (a durable
   * tool's `start`, any other call) to finish, so their outcomes are saved, then interrupts the rest. A durable tool's
   * `attach` is interrupted at once; its work keeps running and its call stays `started` with its handle. Any other
   * call still running stays `starting`: its outcome is unknown.
   */
  detach(graceMs: number): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      const waiting = [...self.fibers].filter(([id]) => self.machine.call(id)?.status !== "started")
      if (waiting.length > 0 && graceMs > 0) {
        yield* Effect.raceFirst(
          Fiber.awaitAll(waiting.map(([, fiber]) => fiber)),
          Effect.sleep(graceMs),
        )
      }
      while (self.fibers.size > 0) {
        for (const id of self.fibers.keys()) self.detached.add(id)
        yield* Fiber.interruptAll([...self.fibers.values()])
      }
    })
  }

  /** Stops host work still running, waiting for its cleanup; a durable tool's work is cancelled. */
  interrupt(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      self.stopping = true
      while (self.fibers.size > 0) yield* Fiber.interruptAll([...self.fibers.values()])
      // A suspended run's durable work keeps running, to be reattached on resume.
      if (self.suspending) return
      for (const call of self.machine.calls()) {
        const request = call.request
        if (call.status !== "started" || request.kind !== "tool" || call.handle === undefined) continue
        yield* Effect.ignore(self.tools.cancel(request.path, call.handle)).pipe(Effect.provideContext(self.services))
      }
    })
  }

  /**
   * Picks up the host calls a restored machine was waiting on: an outcome the host already knows completes its call;
   * a durable call reattaches by handle, or finds its handle by key, or starts; a call that never started starts; any
   * other call that was running re-runs when its tool is safe to retry, and otherwise fails with an error the program
   * can catch, since it may have partially run.
   */
  resume(outcomes: Readonly<Record<string, Outcome>>): void {
    for (const call of this.machine.calls()) {
      const known = outcomes[call.key]
      if (known !== undefined) {
        this.machine.complete(call.id, known.ok ? normal(known.value) : abrupt(toolError(known.error)))
        continue
      }
      const request = call.request
      if (request.kind === "extension") {
        const failure =
          call.status === "queued" ? lostError(`The call to ${call.label}`) : interruptedError(call.label)
        this.machine.complete(call.id, abrupt(failure))
        continue
      }
      if (request.kind === "tool" && this.tools.tool(request.path)?.durable !== undefined) {
        if (call.status === "started" && call.handle !== undefined) this.attach(call)
        else if (call.status === "starting") this.lookup(call)
        else this.launch(call)
        continue
      }
      const retry = request.kind === "search" || this.retries(call)
      if (call.status === "queued" || retry) this.launch(call)
      else this.machine.complete(call.id, abrupt(interruptedError(call.label)))
    }
  }

  private retries(call: HostCall): boolean {
    const request = call.request
    return request.kind === "tool" && this.tools.tool(request.path)?.retry === "safe"
  }

  // Starts host work now; its outcome goes back to the machine: a blocking call's continues the job that made it, a
  // concurrent call's waits in the inbox and settles its promise in a later job, in completion order.
  private launch(call: HostCall): void {
    // A call that was running when its run was suspended was admitted then; running it again is not a new call.
    const again = call.status !== "queued"
    call.status = "starting"
    const request = call.request
    if (request.kind === "tool" && this.tools.tool(request.path)?.durable !== undefined) {
      return this.fork(call.id, this.tools.start(request.path, request.args, call.key, again), (handle) => {
        const current = this.machine.call(call.id)
        if (current === undefined) return
        current.status = "started"
        current.handle = handle as Json
        this.attach(current)
      })
    }
    if (request.kind === "tool") return this.fork(call.id, this.tools.execute(request.path, request.args, again))
    if (request.kind === "search") return this.fork(call.id, this.tools.search(request.args, again))
    // An extension's work, made by the extension bridge with the program's services in its requirements.
    return this.fork(call.id, this.machine.ctx.extensionWork!(request.call) as Effect.Effect<unknown, unknown, R>)
  }

  private attach(call: HostCall): void {
    const request = call.request
    if (request.kind !== "tool") return
    this.fork(call.id, this.tools.attach(request.path, request.args, call.handle!))
  }

  // A durable call that may have started before the run was saved: reattach to its work if it did, else start it.
  private lookup(call: HostCall): void {
    const request = call.request
    if (request.kind !== "tool") return
    this.fork(call.id, this.tools.lookup(request.path, call.key), (handle) => {
      const current = this.machine.call(call.id)
      if (current === undefined) return
      if (handle === undefined) return this.launch(current)
      current.status = "started"
      current.handle = handle as Json
      this.attach(current)
    })
  }

  // Forks `work` with the caller's services; it starts synchronously, so admission and hooks happen before the machine
  // runs another job. A success goes to `next` when given, otherwise to the machine.
  private fork(id: number, work: Effect.Effect<unknown, unknown, R>, next?: (value: unknown) => void): void {
    const fiber = Effect.runForkWith(this.services)(work)
    this.fibers.set(id, fiber)
    fiber.addObserver((exit) => {
      if (this.fibers.get(id) === fiber) this.fibers.delete(id)
      // Interrupted to end or suspend the run: nothing is left to settle.
      if (this.stopping || this.detached.has(id)) return
      const call = this.machine.call(id)
      if (call === undefined) return
      if (next !== undefined && Exit.isSuccess(exit)) return next(exit.value)
      if (call.blocking) {
        // Blocking work interrupted on its own interrupts the execution.
        if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) this.interrupted = exit.cause
        else this.machine.complete(id, Exit.isSuccess(exit) ? normal(exit.value) : abrupt(Cause.squash(exit.cause)))
        this.wake?.()
        return
      }
      this.machine.complete(
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
      if (this.machine.ready || this.suspending || this.interrupted !== undefined) return resume(Effect.void)
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

/** What a call that was running when its run was suspended fails with, when it can't safely run again. */
const interruptedError = (label: string) =>
  toolError(
    `The call to ${label} was interrupted when the run was suspended and may have partially run; check its effects before calling it again.`,
  )
