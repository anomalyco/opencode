export * as BackgroundServiceMachine from "./background-service-machine"

import { Cause, Effect, Exit, FiberSet } from "effect"
import type { SidecarCredentials } from "./sidecar-credentials"

type Data = SidecarCredentials.Data

/** `initial` may adopt a service the entry module found; `reconnect` always runs `Service.ensure`. */
export type ConnectMode = "initial" | "reconnect"

/** Settles one caller of `connection` or `reconnect`. */
export type Reply = {
  readonly resolve: (data: Data) => void
  readonly reject: (cause: unknown) => void
}

/**
 * The connection to the background service every window shares. Each attempt to reach it has an id, and a result
 * of any other attempt is stale. Callers that arrive while an attempt runs wait for that attempt.
 */
export type State =
  /** No service has been reached yet. */
  | { readonly status: "connecting"; readonly attempt: number; readonly waiters: readonly Reply[] }
  /** `data` is the active service. A probed service is still verified by `attempt`'s `Service.ensure`. */
  | { readonly status: "ready"; readonly attempt: number; readonly data: Data }
  /** Requests keep using `data` until the reconnect replaces it. */
  | {
      readonly status: "reconnecting"
      readonly attempt: number
      readonly data: Data
      readonly waiters: readonly Reply[]
    }
  /** The last attempt failed; the next caller starts a new one instead of receiving `error` again. */
  | { readonly status: "failed"; readonly attempt: number; readonly error: unknown; readonly last: Data | undefined }
  | { readonly status: "disposed" }

export type Event =
  | { readonly type: "connection.requested"; readonly reply: Reply }
  | { readonly type: "reconnect.requested"; readonly reply: Reply }
  | { readonly type: "waiter.cancelled"; readonly reply: Reply }
  | { readonly type: "probe.succeeded"; readonly attempt: number; readonly data: Data }
  | { readonly type: "connect.succeeded"; readonly attempt: number; readonly data: Data }
  | { readonly type: "connect.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "verify.succeeded"; readonly attempt: number; readonly data: Data }
  | { readonly type: "verify.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "disposed" }

export type Command =
  | { readonly type: "connect"; readonly attempt: number; readonly mode: ConnectMode }
  | { readonly type: "verify"; readonly attempt: number }
  | { readonly type: "publish"; readonly data: Data }
  | { readonly type: "resolve"; readonly replies: readonly Reply[]; readonly data: Data }
  | { readonly type: "reject"; readonly replies: readonly Reply[]; readonly error: unknown }

export type Transition = {
  readonly state: State
  readonly commands: readonly Command[]
}

const DISPOSED_ERROR = new Error("Background service is disposed")

export function initialTransition(): Transition {
  return {
    state: { status: "connecting", attempt: 1, waiters: [] },
    commands: [{ type: "connect", attempt: 1, mode: "initial" }],
  }
}

export function transition(state: State, event: Event): Transition {
  if (state.status === "disposed") {
    if (event.type === "connection.requested" || event.type === "reconnect.requested")
      return { state, commands: [{ type: "reject", replies: [event.reply], error: DISPOSED_ERROR }] }

    return unchanged(state)
  }

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      commands: "waiters" in state ? reject(state.waiters, DISPOSED_ERROR) : [],
    }

  if (state.status === "connecting" || state.status === "reconnecting") return waiting(state, event)

  if (state.status === "ready") return ready(state, event)

  if (event.type !== "connection.requested" && event.type !== "reconnect.requested") return unchanged(state)

  const attempt = state.attempt + 1

  // A service that was reached before is replaced the way a reconnect replaces it; otherwise this is a new first
  // connect, so a failure that has since been fixed (a config error, a port race) is not replayed.
  if (state.last)
    return {
      state: { status: "reconnecting", attempt, data: state.last, waiters: [event.reply] },
      commands: [{ type: "connect", attempt, mode: "reconnect" }],
    }

  return {
    state: { status: "connecting", attempt, waiters: [event.reply] },
    commands: [{ type: "connect", attempt, mode: "initial" }],
  }
}

function waiting(state: Extract<State, { status: "connecting" | "reconnecting" }>, event: Event): Transition {
  // Every caller joins the attempt in flight, so windows that reconnect together run one `Service.ensure`.
  if (event.type === "connection.requested" || event.type === "reconnect.requested")
    return { state: { ...state, waiters: [...state.waiters, event.reply] }, commands: [] }

  if (event.type === "waiter.cancelled") {
    if (!state.waiters.includes(event.reply)) return unchanged(state)

    return { state: { ...state, waiters: state.waiters.filter((reply) => reply !== event.reply) }, commands: [] }
  }

  if (!("attempt" in event) || event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "probe.succeeded" && state.status === "connecting")
    return {
      state: { status: "ready", attempt: state.attempt, data: event.data },
      commands: [
        { type: "publish", data: event.data },
        ...resolve(state.waiters, event.data),
        { type: "verify", attempt: state.attempt },
      ],
    }

  if (event.type === "connect.succeeded") {
    const changed = state.status === "connecting" || !same(state.data, event.data)

    return {
      state: { status: "ready", attempt: state.attempt, data: event.data },
      commands: [
        ...(changed ? [{ type: "publish" as const, data: event.data }] : []),
        ...resolve(state.waiters, event.data),
      ],
    }
  }

  if (event.type === "connect.failed")
    return {
      state: {
        status: "failed",
        attempt: state.attempt,
        error: event.error,
        last: state.status === "reconnecting" ? state.data : undefined,
      },
      commands: reject(state.waiters, event.error),
    }

  return unchanged(state)
}

function ready(state: Extract<State, { status: "ready" }>, event: Event): Transition {
  if (event.type === "connection.requested")
    return { state, commands: [{ type: "resolve", replies: [event.reply], data: state.data }] }

  if (event.type === "reconnect.requested") {
    const attempt = state.attempt + 1

    // The new attempt also supersedes a verification still running for the current one.
    return {
      state: { status: "reconnecting", attempt, data: state.data, waiters: [event.reply] },
      commands: [{ type: "connect", attempt, mode: "reconnect" }],
    }
  }

  // `Service.ensure` replaced the probed service (it had exited or was incompatible): move every window to it.
  if (event.type === "verify.succeeded" && event.attempt === state.attempt && !same(state.data, event.data))
    return {
      state: { status: "ready", attempt: state.attempt, data: event.data },
      commands: [{ type: "publish", data: event.data }],
    }

  // A failed verification keeps the probed service, which answered the probe; a window that loses it reconnects.
  return unchanged(state)
}

function resolve(replies: readonly Reply[], data: Data): Command[] {
  return replies.length > 0 ? [{ type: "resolve", replies, data }] : []
}

function reject(replies: readonly Reply[], error: unknown): Command[] {
  return replies.length > 0 ? [{ type: "reject", replies, error }] : []
}

function same(a: Data, b: Data) {
  return a.url === b.url && a.password === b.password
}

function unchanged(state: State): Transition {
  return { state, commands: [] }
}

/**
 * Runs the machine for the scope's lifetime. The initial connect starts at once, in the background: windows are
 * created as soon as the main process is up, and their renderers load while the CLI service is resolved.
 */
export const make = Effect.fn("BackgroundServiceMachine.make")(function* (input: {
  /** The compatible service the entry module found, if any. */
  readonly probe: Effect.Effect<Data | undefined, unknown>
  readonly ensure: (mode: ConnectMode) => Effect.Effect<Data, unknown>
  /** Called when the active service changes. */
  readonly publish: (data: Data) => void
}) {
  const fibers = yield* FiberSet.make()
  const run = yield* FiberSet.runtime(fibers)()
  const initial = initialTransition()
  const current = { state: initial.state }

  const dispatch = (event: Event) => {
    const next = transition(current.state, event)
    current.state = next.state
    next.commands.forEach(perform)
  }

  // A failure of `ensure` can be a defect (`DesktopCli.resolve` dies), so every exit reports back as an event. An
  // interrupt only happens on disposal, which the machine already left.
  const report = (effect: Effect.Effect<Event, unknown>, failed: (error: unknown) => Event) =>
    run(
      effect.pipe(
        Effect.exit,
        Effect.flatMap((exit) => {
          if (Exit.isSuccess(exit)) return Effect.sync(() => dispatch(exit.value))

          if (Cause.hasInterruptsOnly(exit.cause)) return Effect.void

          const event = failed(Cause.squash(exit.cause))

          return Effect.logError("v2 CLI background service failed", { event }).pipe(
            Effect.andThen(Effect.sync(() => dispatch(event))),
          )
        }),
      ),
    )

  const perform = (command: Command) => {
    if (command.type === "connect") {
      const attempt = command.attempt

      const connect = (mode: ConnectMode) =>
        input.ensure(mode).pipe(Effect.map((data): Event => ({ type: "connect.succeeded", attempt, data })))

      return void report(
        command.mode === "reconnect"
          ? connect("reconnect")
          : input.probe.pipe(
              Effect.orElseSucceed(() => undefined),
              Effect.flatMap((data) =>
                data ? Effect.succeed<Event>({ type: "probe.succeeded", attempt, data }) : connect("initial"),
              ),
            ),
        (error) => ({ type: "connect.failed", attempt, error }),
      )
    }

    if (command.type === "verify") {
      const attempt = command.attempt

      return void report(
        input.ensure("initial").pipe(Effect.map((data): Event => ({ type: "verify.succeeded", attempt, data }))),
        (error) => ({ type: "verify.failed", attempt, error }),
      )
    }

    if (command.type === "publish") return input.publish(command.data)

    if (command.type === "resolve") return command.replies.forEach((reply) => reply.resolve(command.data))

    command.replies.forEach((reply) => reply.reject(command.error))
  }

  const request = (type: "connection.requested" | "reconnect.requested") =>
    Effect.callback<Data>((resume) => {
      const reply: Reply = {
        resolve: (data) => resume(Effect.succeed(data)),
        reject: (error) => resume(Effect.die(error)),
      }

      dispatch({ type, reply })

      // A window that closes or aborts its reconnect leaves the attempt, which keeps running for the others.
      return Effect.sync(() => dispatch({ type: "waiter.cancelled", reply }))
    })

  yield* Effect.addFinalizer(() => Effect.sync(() => dispatch({ type: "disposed" })))
  initial.commands.forEach(perform)

  return {
    connection: request("connection.requested"),
    reconnect: request("reconnect.requested"),
  }
})
