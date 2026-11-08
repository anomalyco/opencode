import { Cause, type Context, Effect, Exit, Fiber } from "effect"
import type { HostCall } from "../scheduler.js"
import { type ToolRuntime, toolExpression } from "../../tool-runtime.js"
import { locate } from "./errors.js"
import { PendingThrow } from "./model.js"
import type { Vm } from "../vm.js"
import { abrupt, type Completion, Interruption, normal } from "./signals.js"

/** What `Driver.run` returns once the run was suspended: its state is saved, and the VM stopped. */
export const SUSPENDED: unique symbol = Symbol("codemode.suspended")

/**
 * Runs the VM (see `Vm`) in Effect: the only place program execution meets the host. It calls `vm.run`
 * until the program ends, and does what each stop asks: yields to the Effect scheduler for a slice, and starts the host
 * calls the VM queued, as fibers with the caller's services, reporting each outcome back with `vm.complete`.
 * Fibers live only here, by host call id, and never become part of the VM's state.
 *
 * The VM and tool bridge can be swapped for restored ones between stops (the round-trip test mode does); a fiber's
 * outcome goes to whichever VM is current, by host call id.
 */
export class Driver<R> {
  private readonly fibers = new Map<number, Fiber.Fiber<unknown, unknown>>()
  private wake: (() => void) | undefined
  private stopping = false
  private suspending = false
  // Blocking host work interrupted on its own, which interrupts the execution.
  private interrupted: Cause.Cause<unknown> | undefined
  /** Called at every slice and host stop, before queued calls start: the round-trip test mode swaps the VM. */
  checkpoint: Effect.Effect<void, unknown, R> | undefined

  constructor(
    public vm: Vm,
    public tools: ToolRuntime<R>,
    /** The services host work runs with: the caller's, so tools see its context, tracing, and clock. */
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

  /**
   * The host calls that block a suspend now: every call in progress, and a queued or synchronous extension call the
   * program is in the middle of, which holds live host values. A tool call queued but not started starts on resume.
   */
  blocking(): Array<{ readonly path: string }> {
    const vm = this.vm
    const calls = vm.calls().filter((call) => call.status !== "queued" || call.request.kind === "extension")
    const running = calls.map((call) => ({ path: callPath(call) }))
    const active = vm.activeExtension
    if (active !== undefined && !calls.some((call) => call.blocking && call.request.kind === "extension")) {
      running.push(active)
    }
    return running
  }

  /** Whether the run holds live host values: an extension call in progress. */
  get holdsHostValues(): boolean {
    return this.vm.calls().some((call) => call.request.kind === "extension") || this.vm.activeExtension !== undefined
  }

  /** Stops the run to suspend it, once its state is saved: `run` returns `SUSPENDED` at its next step. */
  detach(): void {
    this.suspending = true
    this.wake?.()
  }

  /** Stops host work still running, waiting for its cleanup. */
  interrupt(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      self.stopping = true
      while (self.fibers.size > 0) yield* Fiber.interruptAll([...self.fibers.values()])
    })
  }

  /** Starts any tool calls that were queued when the VM was saved. */
  resume(): void {
    for (const call of this.vm.calls()) {
      if (call.status === "queued") this.launch(call)
    }
  }

  // Starts host work now; its outcome goes back to the VM: a blocking call's continues the job that made it, a
  // concurrent call's waits in the inbox and settles its promise in a later job, in completion order.
  private launch(call: HostCall): void {
    call.status = "running"
    const request = call.request
    if (request.kind === "tool") return this.fork(call.id, this.tools.execute(request.path, request.args))
    if (request.kind === "search") return this.fork(call.id, this.tools.search(request.args))
    // An extension's work, made by the extension bridge with the program's services in its requirements.
    return this.fork(call.id, this.vm.ctx.extensionWork!(request.call) as Effect.Effect<unknown, unknown, R>)
  }

  // Forks `work` with the caller's services; it starts synchronously, so admission and hooks happen before the VM
  // runs another job.
  private fork(id: number, work: Effect.Effect<unknown, unknown, R>): void {
    const fiber = Effect.runForkWith(this.services)(work)
    this.fibers.set(id, fiber)
    fiber.addObserver((exit) => {
      if (this.fibers.get(id) === fiber) this.fibers.delete(id)
      // Interrupted to end the run: nothing is left to settle.
      if (this.stopping) return
      const call = this.vm.call(id)
      if (call === undefined) return
      if (call.blocking) {
        // Blocking work interrupted on its own interrupts the execution.
        if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) this.interrupted = exit.cause
        else this.vm.complete(id, Exit.isSuccess(exit) ? normal(exit.value) : abrupt(Cause.squash(exit.cause)))
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

/** A host call as the program wrote it: `tools.x.y`, `search`, or an extension function's path. */
export const callPath = (call: HostCall): string => {
  const request = call.request
  if (request.kind === "tool") return toolExpression(request.path.flatMap((segment) => segment.split(".")).join("."))
  return request.kind === "search" ? "search" : request.call.label
}
