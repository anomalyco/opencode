import type { Scope } from "@opencode/plugin/gui/host"

/** Runs once every other plugin stopped, e.g. quitAndInstall. */
export type Handoff = () => void | Promise<void>

export type ExitMode = "quit" | "relaunch"

/** Settles the caller's `restart` promise. */
export type Reply = { readonly resolve: () => void; readonly reject: (cause: unknown) => void }

/**
 * Where the app process stands between running and exiting. `attempt` names the async step in flight, so the result
 * of a step a quit superseded is dropped.
 */
export type State =
  | { readonly status: "running"; readonly attempt: number }
  /** The user quit for the first time and is choosing whether the background service outlives the app. */
  | { readonly status: "confirming"; readonly attempt: number }
  /** Every plugin but `keep` is stopping for a restart handoff; without `handoff` the app relaunches next. */
  | {
      readonly status: "suspending"
      readonly attempt: number
      readonly keep: Scope
      readonly handoff?: Handoff
      readonly reply: Reply
    }
  /** The handoff runs while only `keep` is active. */
  | { readonly status: "handing-off"; readonly attempt: number; readonly keep: Scope; readonly reply: Reply }
  /** The handoff failed: the stopped plugins start again before the caller hears of `error`. */
  | { readonly status: "resuming"; readonly attempt: number; readonly error: unknown; readonly reply: Reply }
  /** Every plugin is stopping before the app quits or relaunches. */
  | { readonly status: "stopping"; readonly attempt: number; readonly exit: ExitMode }
  | { readonly status: "quitting" }

export type Event =
  | { readonly type: "restart.requested"; readonly keep: Scope; readonly handoff?: Handoff; readonly reply: Reply }
  | { readonly type: "plugins.stopped"; readonly attempt: number }
  | { readonly type: "handoff.succeeded"; readonly attempt: number }
  | { readonly type: "handoff.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "plugins.resumed"; readonly attempt: number }
  /** A relaunch from the app, or a quit signal from the OS. */
  | { readonly type: "exit.requested"; readonly mode: ExitMode }
  /** Windows logoff or shutdown (`session-end` on each window); Electron emits no `before-quit` for it. */
  | { readonly type: "session.ending" }
  /** `confirm` asks the user first, once, whether the background service should keep running after quit. */
  | { readonly type: "before.quit"; readonly confirm?: boolean }
  | { readonly type: "quit.confirmed"; readonly attempt: number }
  | { readonly type: "will.quit" }

export type RejectReason =
  | { readonly kind: "failed"; readonly error: unknown }
  | { readonly kind: "busy" }
  | { readonly kind: "quitting" }

export type Command =
  | { readonly type: "confirm-quit"; readonly attempt: number }
  | { readonly type: "stop-plugins"; readonly attempt: number }
  | { readonly type: "run-handoff"; readonly attempt: number; readonly handoff: Handoff }
  | { readonly type: "resume-plugins"; readonly attempt: number }
  | { readonly type: "resolve"; readonly reply: Reply }
  | { readonly type: "reject"; readonly reply: Reply; readonly reason: RejectReason }
  | { readonly type: "exit"; readonly mode: ExitMode }

export type Transition = { readonly state: State; readonly commands: readonly Command[] }

export function initialState(): State {
  return { status: "running", attempt: 0 }
}

export function transition(state: State, event: Event): Transition {
  if (event.type === "restart.requested") return restartRequested(state, event)

  if (event.type === "exit.requested") return exitRequested(state, event.mode)

  // The OS ends the session whatever the app asked for, so a pending relaunch becomes a quit.
  if (event.type === "session.ending")
    return state.status === "stopping" && state.exit === "relaunch"
      ? { state: { ...state, exit: "quit" }, commands: [] }
      : exitRequested(state, "quit")

  // A quit that starts while the handoff runs is the handoff's own (quitAndInstall quits before its promise settles),
  // and the plugins it must not wait for are already stopped.
  if (event.type === "before.quit") {
    if (state.status === "handing-off" || state.status === "confirming") return unchanged(state)

    if (state.status === "running" && event.confirm)
      return {
        state: { status: "confirming", attempt: state.attempt + 1 },
        commands: [{ type: "confirm-quit", attempt: state.attempt + 1 }],
      }

    return exitRequested(state, "quit")
  }

  if (event.type === "quit.confirmed")
    return state.status === "confirming" && state.attempt === event.attempt
      ? exitRequested(state, "quit")
      : unchanged(state)

  if (event.type === "will.quit") return willQuit(state)

  return stepSettled(state, event)
}

/** The app starts no plugin, and the windows that close are restored on the next launch. */
export const isQuitting = (state: State) =>
  state.status !== "running" && state.status !== "resuming" && state.status !== "confirming"

/** The scope a stop leaves running: the restart caller's, until the handoff settled. */
export const keptScope = (state: State) =>
  state.status === "suspending" || state.status === "handing-off" ? state.keep : undefined

/** The macOS dock reopens windows until a real quit starts; a restart handoff can still fail and keep the app. */
export const restoresWindows = (state: State) => state.status !== "stopping" && state.status !== "quitting"

/** Electron's `before-quit` waits for the user's answer and for the plugins to stop first. */
export const preventsQuit = (state: State) => state.status !== "handing-off" && state.status !== "quitting"

/**
 * On macOS the app outlives its windows, except during a quit: Electron emits `window-all-closed` instead of `will-quit`
 * when it lost track of one, so finish it.
 */
export const quitsWhenAllWindowsClosed = (state: State, platform: NodeJS.Platform) =>
  platform !== "darwin" || state.status === "stopping" || state.status === "quitting"

/** Whether this stop ends in a quit, as opposed to a restart handoff or a relaunch. */
export const stopsForQuit = (state: State) =>
  state.status === "quitting" || (state.status === "stopping" && state.exit === "quit")

function restartRequested(state: State, event: Extract<Event, { type: "restart.requested" }>): Transition {
  if (state.status === "running")
    return {
      state: {
        status: "suspending",
        attempt: state.attempt + 1,
        keep: event.keep,
        handoff: event.handoff,
        reply: event.reply,
      },
      commands: [{ type: "stop-plugins", attempt: state.attempt + 1 }],
    }

  const kind = state.status === "stopping" || state.status === "quitting" ? "quitting" : "busy"

  return unchanged(state, [{ type: "reject", reply: event.reply, reason: { kind } }])
}

function exitRequested(state: State, mode: ExitMode): Transition {
  if (state.status === "quitting") return unchanged(state)

  // A relaunch asked for while stopping still relaunches, whatever quits it.
  if (state.status === "stopping") {
    const exit = state.exit === "relaunch" ? "relaunch" : mode

    return exit === state.exit ? unchanged(state) : { state: { ...state, exit }, commands: [] }
  }

  return {
    state: { status: "stopping", attempt: state.attempt + 1, exit: mode },
    commands: [...superseded(state), { type: "stop-plugins", attempt: state.attempt + 1 }],
  }
}

function willQuit(state: State): Transition {
  if (state.status === "quitting") return unchanged(state)

  // The stop already in flight finishes on its own; the app exits either way.
  if (state.status === "stopping") return { state: { status: "quitting" }, commands: [] }

  return {
    state: { status: "quitting" },
    commands: [...superseded(state), { type: "stop-plugins", attempt: state.attempt + 1 }],
  }
}

function stepSettled(
  state: State,
  event: Exclude<Extract<Event, { readonly attempt: number }>, { type: "quit.confirmed" }>,
): Transition {
  if (state.status === "quitting" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "plugins.stopped" && state.status === "suspending") {
    if (state.handoff)
      return {
        state: { status: "handing-off", attempt: state.attempt, keep: state.keep, reply: state.reply },
        commands: [{ type: "run-handoff", attempt: state.attempt, handoff: state.handoff }],
      }

    return {
      state: { status: "quitting" },
      commands: [
        { type: "resolve", reply: state.reply },
        { type: "exit", mode: "relaunch" },
      ],
    }
  }

  if (event.type === "plugins.stopped" && state.status === "stopping")
    return { state: { status: "quitting" }, commands: [{ type: "exit", mode: state.exit }] }

  if (event.type === "handoff.succeeded" && state.status === "handing-off")
    return { state: { status: "quitting" }, commands: [{ type: "resolve", reply: state.reply }] }

  if (event.type === "handoff.failed" && state.status === "handing-off")
    return {
      state: { status: "resuming", attempt: state.attempt, error: event.error, reply: state.reply },
      commands: [{ type: "resume-plugins", attempt: state.attempt }],
    }

  if (event.type === "plugins.resumed" && state.status === "resuming")
    return {
      state: { status: "running", attempt: state.attempt },
      commands: [{ type: "reject", reply: state.reply, reason: { kind: "failed", error: state.error } }],
    }

  return unchanged(state)
}

/** Rejects the restart a quit supersedes; a resuming one already failed. */
function superseded(state: State): Command[] {
  if (state.status === "resuming")
    return [{ type: "reject", reply: state.reply, reason: { kind: "failed", error: state.error } }]

  if (state.status === "suspending" || state.status === "handing-off")
    return [{ type: "reject", reply: state.reply, reason: { kind: "quitting" } }]

  return []
}

function unchanged(state: State, commands: Command[] = []): Transition {
  return { state, commands }
}

/**
 * Runs the machine: it applies each event, then performs the commands, each of which reports back through a later
 * event. It holds no other state.
 */
export function createDriver(input: {
  /** Stops every plugin but `keptScope`; never rejects. */
  readonly stop: () => Promise<void>
  /** Starts the plugins a handoff stopped again; never rejects. */
  readonly resume: () => Promise<void>
  /** Asks the user the first-quit question and stores the answer; never rejects. */
  readonly confirm: () => Promise<void>
  readonly exit: (mode: ExitMode) => void
}) {
  const current = { state: initialState() }

  const dispatch = (event: Event) => {
    const next = transition(current.state, event)
    current.state = next.state
    next.commands.forEach(perform)
  }

  const perform = (command: Command) => {
    if (command.type === "stop-plugins") {
      const done = () => dispatch({ type: "plugins.stopped", attempt: command.attempt })

      return void input.stop().then(done, done)
    }

    if (command.type === "confirm-quit") {
      const done = () => dispatch({ type: "quit.confirmed", attempt: command.attempt })

      return void input.confirm().then(done, done)
    }

    if (command.type === "run-handoff")
      return void Promise.resolve()
        .then(command.handoff)
        .then(
          () => dispatch({ type: "handoff.succeeded", attempt: command.attempt }),
          (cause: unknown) => dispatch({ type: "handoff.failed", attempt: command.attempt, error: cause }),
        )

    if (command.type === "resume-plugins") {
      const done = () => dispatch({ type: "plugins.resumed", attempt: command.attempt })

      return void input.resume().then(done, done)
    }

    if (command.type === "resolve") return command.reply.resolve()

    if (command.type === "reject") return command.reply.reject(rejection(command.reason))

    input.exit(command.mode)
  }

  return {
    state: () => current.state,
    dispatch,
    /** Stops every plugin but `keep`, then runs the handoff, or relaunches without one. Rejects when the handoff fails. */
    restart: (keep: Scope, handoff?: Handoff) =>
      new Promise<void>((resolve, reject) =>
        dispatch({ type: "restart.requested", keep, handoff, reply: { resolve, reject } }),
      ),
  }
}

function rejection(reason: RejectReason) {
  if (reason.kind === "failed") return reason.error

  if (reason.kind === "busy") return new Error("Application restart is already in progress")

  return new Error("Application is quitting")
}
