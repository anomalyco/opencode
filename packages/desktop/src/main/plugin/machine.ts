import { PluginError } from "./error"
import type { ErrorLog } from "./lifecycle"

/** Bounds one load of the host module and the CLI, so no caller waits on a hung load forever. */
export const LOAD_TIMEOUT_MS = 30_000

/** Settles a caller's promise. */
export type Reply<Value> = { readonly resolve: (value: Value) => void; readonly reject: (cause: unknown) => void }

/**
 * Where the main-process plugin host stands. `attempt` names the load in flight, so a load that a stop, a timeout or
 * disposal superseded is dropped without building its host. `started` records that the app asked for main plugins,
 * so a load that succeeds after a failed one still activates them.
 */
export type State<Host> =
  /** No host yet: the next use loads it, also after a failed or timed-out load. */
  | { readonly status: "idle"; readonly attempt: number; readonly started: boolean }
  | {
      readonly status: "loading"
      readonly attempt: number
      readonly started: boolean
      readonly hosts: readonly Reply<Host>[]
      readonly starts: readonly Reply<void>[]
    }
  /** Stays ready through a stop: the plugin a restart handoff keeps still runs, and the host gates activation itself. */
  | { readonly status: "ready"; readonly host: Host; readonly started: boolean }
  /** The app stopped its plugins before a host loaded: nothing loads until it resumes them. */
  | { readonly status: "stopped"; readonly attempt: number; readonly started: boolean }
  | { readonly status: "disposed" }

export type Event<Host> =
  | { readonly type: "host.requested"; readonly reply: Reply<Host> }
  /** A window subscribed to an Ipc and waits on the plugin that provides it. */
  | { readonly type: "demand.requested"; readonly ipc: string }
  | { readonly type: "start.requested"; readonly reply: Reply<void> }
  | { readonly type: "load.succeeded"; readonly attempt: number; readonly host: Host }
  | { readonly type: "load.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "load.timed-out"; readonly attempt: number }
  | { readonly type: "stop.requested"; readonly reply: Reply<void> }
  | { readonly type: "resume.requested"; readonly reply: Reply<void> }
  | { readonly type: "disposed" }

export type RejectReason =
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "timed-out" }
  | { readonly kind: "unavailable" }

export type Command<Host> =
  | { readonly type: "load"; readonly attempt: number }
  | { readonly type: "start"; readonly host: Host; readonly replies: readonly Reply<void>[] }
  | { readonly type: "demand"; readonly host: Host; readonly ipc: string }
  /** Demands every Ipc a window subscribed to while no host was loaded. */
  | { readonly type: "demand-subscribed"; readonly host: Host }
  | { readonly type: "stop"; readonly host: Host; readonly reply: Reply<void> }
  | { readonly type: "resume"; readonly host: Host; readonly reply: Reply<void> }
  | { readonly type: "resolve-host"; readonly host: Host; readonly replies: readonly Reply<Host>[] }
  | { readonly type: "resolve"; readonly replies: readonly Reply<void>[] }
  | {
      readonly type: "reject"
      readonly replies: readonly Pick<Reply<never>, "reject">[]
      readonly reason: RejectReason
    }

export type Transition<Host> = { readonly state: State<Host>; readonly commands: readonly Command<Host>[] }

export function initialState<Host>(): State<Host> {
  return { status: "idle", attempt: 0, started: false }
}

export function transition<Host>(state: State<Host>, event: Event<Host>): Transition<Host> {
  if (state.status === "disposed") return disposed(state, event)

  if (event.type === "disposed") return dispose(state)

  if (event.type === "stop.requested") return stop(state, event.reply)

  if (event.type === "resume.requested") return resume(state, event.reply)

  if (state.status === "ready") return ready(state, event)

  if (state.status === "loading") return loading(state, event)

  if (event.type === "host.requested") {
    if (state.status === "stopped") return unchanged<Host>(state, [reject([event.reply], { kind: "unavailable" })])

    return load(state, { hosts: [event.reply] })
  }

  if (event.type === "start.requested") {
    if (state.status === "stopped")
      return { state: { ...state, started: true }, commands: [{ type: "resolve", replies: [event.reply] }] }

    return load(state, { started: true, starts: [event.reply] })
  }

  if (event.type === "demand.requested" && state.status === "idle") return load(state, {})

  return unchanged(state)
}

/** The host once it loaded, until the app disposed it. */
export const loadedHost = <Host>(state: State<Host>) => (state.status === "ready" ? state.host : undefined)

/** Whether `attempt` is the load in flight, so its host may still be built. */
export const isLoading = <Host>(state: State<Host>, attempt: number) =>
  state.status === "loading" && state.attempt === attempt

/** Claims the next load in the same event that asked for it. */
function load<Host>(
  state: Extract<State<Host>, { status: "idle" | "stopped" }>,
  input: { readonly started?: boolean; readonly hosts?: Reply<Host>[]; readonly starts?: Reply<void>[] },
): Transition<Host> {
  const attempt = state.attempt + 1

  return {
    state: {
      status: "loading",
      attempt,
      started: state.started || !!input.started,
      hosts: input.hosts ?? [],
      starts: input.starts ?? [],
    },
    commands: [{ type: "load", attempt }],
  }
}

function loading<Host>(state: Extract<State<Host>, { status: "loading" }>, event: Event<Host>): Transition<Host> {
  if (event.type === "host.requested")
    return { state: { ...state, hosts: [...state.hosts, event.reply] }, commands: [] }

  if (event.type === "start.requested")
    return { state: { ...state, started: true, starts: [...state.starts, event.reply] }, commands: [] }

  if (event.type !== "load.succeeded" && event.type !== "load.failed" && event.type !== "load.timed-out")
    return unchanged(state)

  if (event.attempt !== state.attempt) return unchanged(state)

  if (event.type === "load.succeeded")
    return {
      state: { status: "ready", host: event.host, started: state.started },
      commands: [
        ...(state.hosts.length ? [{ type: "resolve-host" as const, host: event.host, replies: state.hosts }] : []),
        state.started
          ? { type: "start", host: event.host, replies: state.starts }
          : { type: "demand-subscribed", host: event.host },
      ],
    }

  return {
    state: { status: "idle", attempt: state.attempt, started: state.started },
    commands: waiters(
      state,
      event.type === "load.failed" ? { kind: "failed", error: event.error } : { kind: "timed-out" },
    ),
  }
}

function ready<Host>(state: Extract<State<Host>, { status: "ready" }>, event: Event<Host>): Transition<Host> {
  if (event.type === "host.requested")
    return unchanged<Host>(state, [{ type: "resolve-host", host: state.host, replies: [event.reply] }])

  if (event.type === "demand.requested")
    return unchanged<Host>(state, [{ type: "demand", host: state.host, ipc: event.ipc }])

  if (event.type === "start.requested") {
    if (state.started) return unchanged<Host>(state, [{ type: "resolve", replies: [event.reply] }])

    return {
      state: { ...state, started: true },
      commands: [{ type: "start", host: state.host, replies: [event.reply] }],
    }
  }

  return unchanged(state)
}

function stop<Host>(state: Exclude<State<Host>, { status: "disposed" }>, reply: Reply<void>): Transition<Host> {
  // A second stop (a quit during a restart handoff) also stops the plugin the handoff kept.
  if (state.status === "ready") return unchanged<Host>(state, [{ type: "stop", host: state.host, reply }])

  if (state.status === "stopped") return unchanged<Host>(state, [{ type: "resolve", replies: [reply] }])

  // A load in flight is dropped: its host is never built against storage that is about to close.
  if (state.status === "loading")
    return {
      state: { status: "stopped", attempt: state.attempt, started: state.started },
      commands: [
        ...(state.hosts.length ? [reject<Host>(state.hosts, { kind: "unavailable" })] : []),
        { type: "resolve" as const, replies: [...state.starts, reply] },
      ],
    }

  return {
    state: { status: "stopped", attempt: state.attempt, started: state.started },
    commands: [{ type: "resolve", replies: [reply] }],
  }
}

function resume<Host>(state: Exclude<State<Host>, { status: "disposed" }>, reply: Reply<void>): Transition<Host> {
  if (state.status === "ready") return unchanged<Host>(state, [{ type: "resume", host: state.host, reply }])

  if (state.status !== "stopped") return unchanged<Host>(state, [{ type: "resolve", replies: [reply] }])

  // Main plugins the stop kept from starting start now, and the resume settles once they did.
  if (state.started) return load(state, { starts: [reply] })

  return {
    state: { status: "idle", attempt: state.attempt, started: false },
    commands: [{ type: "resolve", replies: [reply] }],
  }
}

function dispose<Host>(state: Exclude<State<Host>, { status: "disposed" }>): Transition<Host> {
  if (state.status !== "loading") return { state: { status: "disposed" }, commands: [] }

  return {
    state: { status: "disposed" },
    commands: [
      ...(state.hosts.length ? [reject<Host>(state.hosts, { kind: "unavailable" })] : []),
      ...(state.starts.length ? [{ type: "resolve" as const, replies: state.starts }] : []),
    ],
  }
}

function disposed<Host>(state: Extract<State<Host>, { status: "disposed" }>, event: Event<Host>): Transition<Host> {
  if (event.type === "host.requested") return unchanged<Host>(state, [reject([event.reply], { kind: "unavailable" })])

  if (event.type === "start.requested" || event.type === "stop.requested" || event.type === "resume.requested")
    return unchanged<Host>(state, [{ type: "resolve", replies: [event.reply] }])

  return unchanged(state)
}

function waiters<Host>(state: Extract<State<Host>, { status: "loading" }>, reason: RejectReason): Command<Host>[] {
  const replies = [...state.hosts, ...state.starts]

  return replies.length ? [reject(replies, reason)] : []
}

function reject<Host>(replies: readonly Pick<Reply<never>, "reject">[], reason: RejectReason): Command<Host> {
  return { type: "reject", replies, reason }
}

function unchanged<Host>(state: State<Host>, commands: Command<Host>[] = []): Transition<Host> {
  return { state, commands }
}

/**
 * Runs the machine: it applies each event, then performs the commands, each of which reports back through a later
 * event. Besides the load timers it holds no other state.
 */
export function createDriver<
  Host extends {
    start(): Promise<void>
    stop(): Promise<void>
    resume(): Promise<void>
    demand(ipc: string): void
  },
>(input: {
  /** Loads the host module and the CLI, and returns how to build the host from them. */
  readonly load: () => Promise<() => Host>
  /** The Ipcs windows subscribed to. */
  readonly subscribed: () => readonly string[]
  readonly log: ErrorLog
}) {
  const current = { state: initialState<Host>() }

  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  const dispatch = (event: Event<Host>) => {
    const previous = current.state
    const next = transition(previous, event)
    current.state = next.state

    if (previous.status === "loading" && next.state.status !== "loading") {
      clearTimeout(timers.get(previous.attempt))
      timers.delete(previous.attempt)
    }

    next.commands.forEach(perform)
  }

  const perform = (command: Command<Host>) => {
    if (command.type === "load") {
      timers.set(
        command.attempt,
        setTimeout(() => dispatch({ type: "load.timed-out", attempt: command.attempt }), LOAD_TIMEOUT_MS),
      )

      return void Promise.resolve()
        .then(input.load)
        // Building the host reads storage and follows windows, the locale and the menubar, so a load that something
        // superseded while it ran builds nothing.
        .then((build) => (isLoading(current.state, command.attempt) ? build() : undefined))
        .then(
          (host) => {
            if (host) dispatch({ type: "load.succeeded", attempt: command.attempt, host })
          },
          (cause: unknown) => dispatch({ type: "load.failed", attempt: command.attempt, error: cause }),
        )
    }

    if (command.type === "start")
      return void Promise.resolve()
        .then(() => command.host.start())
        .then(
          () => command.replies.forEach((reply) => reply.resolve()),
          (cause: unknown) => {
            // Nobody waits on a start a later load carried over from a failed one.
            if (!command.replies.length) return input.log("plugins failed to start", { error: cause })

            command.replies.forEach((reply) => reply.reject(cause))
          },
        )

    if (command.type === "demand") return command.host.demand(command.ipc)

    if (command.type === "demand-subscribed") return input.subscribed().forEach((ipc) => command.host.demand(ipc))

    // The app quits whether or not every plugin stopped cleanly.
    if (command.type === "stop")
      return void Promise.resolve()
        .then(() => command.host.stop())
        .catch((cause: unknown) => input.log("plugins failed to stop", { error: cause }))
        .then(() => command.reply.resolve())

    if (command.type === "resume")
      return void Promise.resolve()
        .then(() => command.host.resume())
        .then(command.reply.resolve, command.reply.reject)

    if (command.type === "resolve-host") return command.replies.forEach((reply) => reply.resolve(command.host))

    if (command.type === "resolve") return command.replies.forEach((reply) => reply.resolve())

    const cause = rejection(command.reason)
    command.replies.forEach((reply) => reply.reject(cause))
  }

  const ask = <Value>(event: (reply: Reply<Value>) => Event<Host>) =>
    new Promise<Value>((resolve, reject) => dispatch(event({ resolve, reject })))

  return {
    state: () => current.state,
    /** Loads the host on first use, and again after a load failed. */
    host: () => ask<Host>((reply) => ({ type: "host.requested", reply })),
    /** Loads the host and activates main plugins; a later load activates them when this one fails. */
    start: () => ask<void>((reply) => ({ type: "start.requested", reply })),
    demand: (ipc: string) => dispatch({ type: "demand.requested", ipc }),
    stop: () => ask<void>((reply) => ({ type: "stop.requested", reply })),
    resume: () => ask<void>((reply) => ({ type: "resume.requested", reply })),
    dispose: () => dispatch({ type: "disposed" }),
  }
}

function rejection(reason: RejectReason) {
  if (reason.kind === "failed") return reason.error

  if (reason.kind === "timed-out") return new PluginError("failed", { message: "plugin host load timed out" })

  return new PluginError("unavailable")
}
