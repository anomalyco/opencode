import { Cause, type Context, Effect, Exit, Fiber } from "effect"
import type { Machine } from "../machine/machine.js"
import type { HostCall } from "../machine/scheduler.js"
import type { ToolRuntime } from "../tool-runtime.js"
import { locate } from "./errors.js"
import { PendingThrow } from "./model.js"
import { abrupt, type Completion, Interruption, normal } from "./signals.js"

/**
 * Runs a machine in Effect: the only place program execution meets the host. It calls `machine.run` until the program
 * ends, and does what each stop asks: yields to the Effect scheduler for a slice, and starts the host calls the machine
 * queued, as fibers with the caller's services, reporting each outcome back with `machine.complete`. Fibers live only
 * here, by host call id, and never become part of the machine's state.
 */
export class Driver<R> {
  private readonly fibers = new Map<number, Fiber.Fiber<unknown, unknown>>()
  private wake: (() => void) | undefined
  private stopping = false

  constructor(
    private readonly machine: Machine,
    private readonly tools: ToolRuntime<R>,
    /** The services host work runs with: the caller's, so tools see its context, tracing, and clock. */
    private readonly services: Context.Context<R>,
  ) {}

  /**
   * Runs the machine until the program's body completes, then returns how it ended. Host work it started may still be
   * running; `interrupt` stops it. Host work interrupted on its own that reaches the program's body, or blocking host
   * work that is interrupted, interrupts the execution.
   */
  run(): Effect.Effect<Completion, unknown, R> {
    const self = this
    const machine = this.machine
    return Effect.gen(function* () {
      while (true) {
        const stop = machine.run()
        if (stop.kind === "slice") {
          yield* Effect.yieldNow
          continue
        }
        if (stop.kind === "host") {
          if (stop.calls.length === 0) {
            yield* self.settled
            continue
          }
          for (const call of stop.calls) {
            if (!call.blocking) {
              self.start(call)
              continue
            }
            const exit = yield* Effect.exit(self.work(call))
            if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
            machine.complete(call.id, Exit.isSuccess(exit) ? normal(exit.value) : abrupt(Cause.squash(exit.cause)))
          }
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

  /** Stops host work still running, waiting for its cleanup. */
  interrupt(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      self.stopping = true
      while (self.fibers.size > 0) yield* Fiber.interruptAll([...self.fibers.values()])
    })
  }

  private work(call: HostCall): Effect.Effect<unknown, unknown, R> {
    const request = call.request
    if (request.kind === "tool") return this.tools.execute(request.path, request.args)
    if (request.kind === "search") return this.tools.search(request.args)
    // An extension's work, made by the extension bridge with the program's services in its requirements.
    return request.effect as Effect.Effect<unknown, unknown, R>
  }

  // Starts concurrent host work now; its outcome goes back to the machine's inbox, in completion order.
  private start(call: HostCall): void {
    // Starts synchronously, so admission and hooks happen before the machine runs another job.
    const fiber = Effect.runForkWith(this.services)(this.work(call))
    this.fibers.set(call.id, fiber)
    fiber.addObserver((exit) => {
      this.fibers.delete(call.id)
      // Interrupted by the program ending: nothing is left to settle.
      if (this.stopping) return
      this.machine.complete(
        call.id,
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
      if (this.machine.ready) return resume(Effect.void)
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
