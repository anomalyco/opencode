import { Cause, type Context, Effect, Exit, Fiber } from "effect"
import type { Json } from "../data.js"
import type { HostCall } from "../scheduler.js"
import type { ToolRuntime } from "../../tool-runtime.js"
import { toolError } from "../../tool-error.js"
import type { SuspendError } from "../../suspend-error.js"
import { locate } from "./errors.js"
import { PendingThrow } from "./model.js"
import { toolExpression } from "../../tool-runtime.js"
import type { Vm } from "../vm.js"
import { abrupt, type Completion, Interruption, normal } from "./signals.js"

/** What `Driver.run` returns once the run was suspended: its state is saved, and the VM stopped. */
export const SUSPENDED: unique symbol = Symbol("codemode.suspended")

/** An outcome the host already knows for a pending call, by its key, handed to a resumed run. */
export type Outcome = { readonly ok: true; readonly value: Json } | { readonly ok: false; readonly error: string }

/**
 * Runs the VM (see `Vm`) in Effect: the only place program execution meets the host. It calls `vm.run`
 * until the program ends, and does what each stop asks: yields to the Effect scheduler for a slice, and starts the host
 * calls the VM queued, as fibers with the caller's services, reporting each outcome back with `vm.complete`.
 * Fibers live only here, by host call id, and never become part of the VM's state.
 *
 * A durable tool's call runs as two fibers, `start` then `attach`, so suspending can detach the second and keep the
 * handle `start` gave. The VM and tool bridge can be swapped for restored ones between stops (the round-trip test
 * mode does); a fiber's outcome goes to whichever VM is current, by host call id.
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
  /**
   * Suspends the run for a durable call that asked to, by id: why it couldn't, or undefined once it is suspended
   * (`detach` has run). Set by the execution.
   */
  suspendFor: ((id: number) => SuspendError | undefined) | undefined
  // Durable calls' `ctx.suspend` requests, by call id, served once the call's fiber is registered.
  private readonly requests = new Map<number, (effect: Effect.Effect<never, SuspendError>) => void>()

  constructor(
    public vm: Vm,
    public tools: ToolRuntime<R>,
    /** The services host work runs with: the caller's, so tools see its context, tracing, and clock. */
    private readonly services: Context.Context<R>,
  ) {}

  /**
   * Runs the VM until the program's body completes, then returns how it ended, or `SUSPENDED` once the run was
   * suspended (see `detach`). Host work it started may still be running; `interrupt` stops it.
   * Host work interrupted on its own that reaches the program's body, or blocking host work that is interrupted,
   * interrupts the execution.
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
          for (const handed of stop.calls) {
            self.launch(self.vm.call(handed.id) ?? handed)
            // A call that suspended the run as it started leaves the rest queued, to start on resume.
            if (self.suspending) break
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

  /**
   * The host calls that block a suspend now, but `asking`, a durable call suspending the run itself: every call in
   * progress but a durable tool's started work, which has its handle, and a tool call queued but not started, which
   * starts on resume. A queued extension call blocks too, and so does a synchronous one the program is in the middle
   * of, started or not: they hold live host values. One not started yet has no key.
   */
  blocking(asking?: HostCall): Array<{ readonly key: string; readonly path: string }> {
    const vm = this.vm
    const calls = vm
      .calls()
      .filter(
        (call) =>
          call !== asking &&
          call.status !== "started" &&
          (call.status !== "queued" || call.request.kind === "extension"),
      )
    const running = calls.map((call) => ({ key: call.key, path: callPath(call) }))
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

  /**
   * Stops the run to suspend it, once its state is saved: `run` returns `SUSPENDED` at its next step, and running
   * durable calls' fibers are detached, so ending them leaves their work running and reports nothing.
   */
  detach(): void {
    this.suspending = true
    for (const id of this.fibers.keys()) this.detached.add(id)
    this.wake?.()
  }

  /** Stops host work still running, waiting for its cleanup; a durable tool's work is cancelled unless detached. */
  interrupt(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      self.stopping = true
      while (self.fibers.size > 0) yield* Fiber.interruptAll([...self.fibers.values()])
      // A suspended run's durable work keeps running, for the host to wait on.
      if (self.suspending) return
      for (const call of self.vm.calls()) {
        const request = call.request
        if (call.status !== "started" || request.kind !== "tool" || call.handle === undefined) continue
        yield* Effect.ignore(self.tools.cancel(request.path, call.handle)).pipe(Effect.provideContext(self.services))
      }
    })
  }

  /**
   * Picks up the host calls a restored VM was waiting on: the host's outcomes, copied as JSON, complete pending
   * durable calls, by key, and calls that never started start.
   */
  resume(outcomes: Readonly<Record<string, Outcome>>): void {
    for (const call of this.vm.calls()) {
      const known = Object.hasOwn(outcomes, call.key) ? outcomes[call.key] : undefined
      if (known !== undefined) {
        this.vm.complete(call.id, known.ok ? normal(copy(known.value)) : abrupt(toolError(String(known.error))))
        continue
      }
      if (call.status === "queued") this.launch(call)
    }
  }

  // Starts host work now; its outcome goes back to the VM: a blocking call's continues the job that made it, a
  // concurrent call's waits in the inbox and settles its promise in a later job, in completion order.
  private launch(call: HostCall): void {
    call.status = "starting"
    const request = call.request
    if (request.kind === "tool" && this.tools.tool(request.path)?.durable !== undefined) {
      const started = this.tools.start(request.path, request.args, call.key, this.suspension(call.id))
      return this.fork(call.id, started, (handle) => {
        const current = this.vm.call(call.id)
        if (current === undefined) return
        current.status = "started"
        current.handle = handle as Json
        this.attach(current)
      })
    }
    if (request.kind === "tool") return this.fork(call.id, this.tools.execute(request.path, request.args, call.key))
    if (request.kind === "search") return this.fork(call.id, this.tools.search(request.args, call.key))
    // An extension's work, made by the extension bridge with the program's services in its requirements.
    return this.fork(call.id, this.vm.ctx.extensionWork!(request.call) as Effect.Effect<unknown, unknown, R>)
  }

  private attach(call: HostCall): void {
    const request = call.request
    if (request.kind !== "tool") return
    this.fork(
      call.id,
      this.tools.attach(
        request.path,
        request.args,
        call.key,
        call.handle!,
        () => this.suspending,
        this.suspension(call.id),
      ),
    )
  }

  // A durable call's `ctx.suspend`. It is served once the call's fiber is registered, so one made synchronously, as
  // the call starts, sees the same running calls as one made later. Once the run is suspended it never returns: the
  // fiber is detached, and interrupted.
  private suspension(id: number): Effect.Effect<never, SuspendError> {
    return Effect.callback<never, SuspendError>((resume) => {
      this.requests.set(id, resume)
      if (this.fibers.has(id)) this.serve(id)
      return Effect.sync(() => {
        this.requests.delete(id)
      })
    })
  }

  private serve(id: number): void {
    const resume = this.requests.get(id)
    if (resume === undefined) return
    this.requests.delete(id)
    const failure = this.suspendFor?.(id)
    if (failure !== undefined) resume(Effect.fail(failure))
  }

  // Forks `work` with the caller's services; it starts synchronously, so admission and hooks happen before the VM
  // runs another job. A success goes to `next` when given, otherwise to the VM.
  private fork(id: number, work: Effect.Effect<unknown, unknown, R>, next?: (value: unknown) => void): void {
    const fiber = Effect.runForkWith(this.services)(work)
    this.fibers.set(id, fiber)
    this.serve(id)
    fiber.addObserver((exit) => {
      if (this.fibers.get(id) === fiber) this.fibers.delete(id)
      // Interrupted to end or suspend the run: nothing is left to settle.
      if (this.stopping || this.detached.has(id)) return
      const call = this.vm.call(id)
      if (call === undefined) return
      if (next !== undefined && Exit.isSuccess(exit)) return next(exit.value)
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

// The same round trip a tool's result takes: exact JSON.stringify semantics.
const copy = (value: Json): Json | undefined => {
  const text = JSON.stringify(value)
  return text === undefined ? undefined : JSON.parse(text)
}

/** A host call as the program wrote it: `tools.x.y`, `search`, or an extension function's path. */
export const callPath = (call: HostCall): string => {
  const request = call.request
  if (request.kind === "tool") return toolExpression(request.path.flatMap((segment) => segment.split(".")).join("."))
  return request.kind === "search" ? "search" : request.call.label
}
