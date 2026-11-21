/** Delay between JavaScript call-stack samples while a renderer is unresponsive. */
export const SAMPLE_INTERVAL_MS = 1_000

/** How long one unresponsive call-stack sampling session lasts. */
export const SAMPLE_PERIOD_MS = 15_000

/** Bounds a debug-log export, so a hung export never leaves the window without a recovery prompt. */
export const EXPORT_TIMEOUT_MS = 30_000

export type RecoveryAction = "relaunch" | "export-logs" | "keep-waiting" | "quit"

/** What went wrong with the renderer. A higher-priority incident replaces a lower one: terminated > load-failed > unresponsive. */
export type RecoveryIncident =
  | { readonly kind: "unresponsive" }
  | { readonly kind: "load-failed"; readonly url: string; readonly code: number; readonly description: string }
  | { readonly kind: "terminated"; readonly reason: string; readonly exitCode: number | undefined }

/** One unresponsive call-stack sampling session. `collecting` is true while a stack collection is in flight. */
export type SampleSession = {
  readonly attempt: number
  readonly collecting: boolean
  readonly samples: ReadonlyMap<string, number>
}

/**
 * One window's renderer recovery prompt and unresponsive sampler. `attempt` only grows over the window's lifetime:
 * it names the open dialog or running export, and every sampling session takes its own attempt from the same
 * counter, so a late result from an earlier dialog, export or sampling session never matches a current one.
 */
export type RecoveryState =
  | { readonly status: "idle"; readonly attempt: number }
  /** The user chose Keep Waiting while the unresponsive sampling session is still running. */
  | { readonly status: "sampling"; readonly attempt: number; readonly sample: SampleSession }
  | {
      readonly status: "dialog"
      readonly attempt: number
      readonly incident: RecoveryIncident
      /** Present only while an `unresponsive` incident's sampling session is running. */
      readonly sample: SampleSession | undefined
    }
  | {
      readonly status: "exporting"
      readonly attempt: number
      /**
       * The incident whose dialog reopens once the export settles. Cleared when the renderer recovers from an
       * `unresponsive` incident mid-export; replaced when a higher-priority incident arrives.
       */
      readonly incident: RecoveryIncident | undefined
      /** True when the dialog reopens with a new sampling session. */
      readonly resumeSampling: boolean
    }
  /** The window closed, or the user chose Relaunch or Quit. */
  | { readonly status: "closed" }

export type RecoveryEvent =
  | {
      readonly type: "load.failed"
      readonly url: string
      readonly code: number
      readonly description: string
      readonly isMainFrame: boolean
    }
  | { readonly type: "process.gone"; readonly reason: string; readonly exitCode: number | undefined }
  | { readonly type: "renderer.unresponsive"; readonly devtoolsOpen: boolean }
  | { readonly type: "renderer.responsive" }
  | { readonly type: "dialog.responded"; readonly attempt: number; readonly action: RecoveryAction | undefined }
  | { readonly type: "dialog.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "export.succeeded"; readonly attempt: number; readonly devtoolsOpen: boolean }
  | {
      readonly type: "export.failed"
      readonly attempt: number
      readonly error: unknown
      readonly devtoolsOpen: boolean
    }
  | { readonly type: "export.timed-out"; readonly attempt: number; readonly devtoolsOpen: boolean }
  | { readonly type: "sample.tick"; readonly attempt: number }
  | { readonly type: "sample.collected"; readonly attempt: number; readonly stack: string | undefined }
  | { readonly type: "sample.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "sample.window-elapsed"; readonly attempt: number }
  | { readonly type: "window.closed" }

export type RecoveryErrorKind = "dialog" | "export" | "export-timeout" | "sample" | "command"

export type RecoveryFailure = { readonly kind: RecoveryErrorKind; readonly error?: unknown }

export type RecoveryCommand =
  | { readonly type: "reveal" }
  | { readonly type: "open-dialog"; readonly attempt: number }
  | { readonly type: "close-dialog"; readonly attempt: number }
  | { readonly type: "export-logs"; readonly attempt: number }
  | { readonly type: "start-export-timeout"; readonly attempt: number }
  | { readonly type: "cancel-export-timeout" }
  | { readonly type: "start-sample-tick"; readonly attempt: number }
  | { readonly type: "start-sample-window"; readonly attempt: number }
  | { readonly type: "cancel-sample-timers" }
  | { readonly type: "collect-sample"; readonly attempt: number }
  | { readonly type: "flush-samples"; readonly samples: ReadonlyMap<string, number> }
  | ({ readonly type: "log-error" } & RecoveryFailure)
  | { readonly type: "relaunch" }
  | { readonly type: "quit" }

export type RecoveryTransition = {
  readonly state: RecoveryState
  readonly commands: readonly RecoveryCommand[]
}

export type RecoveryDialogView = {
  readonly attempt: number
  readonly incident: RecoveryIncident
  readonly actions: readonly RecoveryAction[]
  readonly defaultId: 0
  readonly cancelId: 2
}

// Chromium reports an aborted navigation (a redirect or a newer load) as a failed load.
const ERR_ABORTED = -3

const INITIAL: RecoveryState = Object.freeze({ status: "idle", attempt: 0 })

const CLOSED: RecoveryState = Object.freeze({ status: "closed" })

const UNRESPONSIVE: RecoveryIncident = Object.freeze({ kind: "unresponsive" })

const UNRESPONSIVE_ACTIONS: readonly RecoveryAction[] = Object.freeze(["relaunch", "export-logs", "keep-waiting"])

const FATAL_ACTIONS: readonly RecoveryAction[] = Object.freeze(["relaunch", "export-logs", "quit"])

const PRIORITY = { unresponsive: 1, "load-failed": 2, terminated: 3 } satisfies Record<RecoveryIncident["kind"], number>

export function initialRecoveryState(): RecoveryState {
  return INITIAL
}

export function transitionRecovery(state: RecoveryState, event: RecoveryEvent): RecoveryTransition {
  if (state.status === "closed") return unchanged(state)

  switch (event.type) {
    case "window.closed":
      return close(state)

    case "load.failed":
      if (!event.isMainFrame || event.code === ERR_ABORTED) return unchanged(state)

      return report(
        state,
        { kind: "load-failed", url: event.url, code: event.code, description: event.description },
        false,
      )

    case "process.gone":
      return report(state, { kind: "terminated", reason: event.reason, exitCode: event.exitCode }, false)

    case "renderer.unresponsive":
      return report(state, UNRESPONSIVE, event.devtoolsOpen)

    case "renderer.responsive":
      return recover(state)

    case "dialog.responded":
    case "dialog.failed":
      return answer(state, event)

    case "export.succeeded":
    case "export.failed":
    case "export.timed-out":
      return settleExport(state, event)

    case "sample.tick":
    case "sample.collected":
    case "sample.failed":
    case "sample.window-elapsed":
      return sample(state, event)
  }
}

/** The dialog the window shows now, or undefined when none should be open. */
export function selectDialog(state: RecoveryState): RecoveryDialogView | undefined {
  if (state.status !== "dialog") return undefined

  return {
    attempt: state.attempt,
    incident: state.incident,
    actions: state.incident.kind === "unresponsive" ? UNRESPONSIVE_ACTIONS : FATAL_ACTIONS,
    defaultId: 0,
    cancelId: 2,
  }
}

/** Formats aggregated unresponsive call-stack samples, most frequent first. */
export function formatUnresponsiveSamples(windowName: string, url: string, samples: ReadonlyMap<string, number>) {
  const entries = [...samples.entries()].sort((a, b) => b[1] - a[1])

  return [
    "renderer unresponsive samples",
    `Window: ${windowName}`,
    `URL: ${url}`,
    ...entries.map((entry) => `<${entry[1]}> ${entry[0]}`),
    `Total Samples: ${entries.reduce((sum, entry) => sum + entry[1], 0)}`,
  ].join("\n")
}

function close(state: Exclude<RecoveryState, { status: "closed" }>): RecoveryTransition {
  if (state.status === "idle") return { state: CLOSED, commands: [] }

  if (state.status === "sampling") return { state: CLOSED, commands: stopSample(state.sample) }

  if (state.status === "exporting") return { state: CLOSED, commands: [{ type: "cancel-export-timeout" }] }

  return { state: CLOSED, commands: [...stopSample(state.sample), { type: "close-dialog", attempt: state.attempt }] }
}

// A new incident opens its dialog unless an incident of the same or higher priority is already being handled.
function report(
  state: Exclude<RecoveryState, { status: "closed" }>,
  incident: RecoveryIncident,
  devtoolsOpen: boolean,
): RecoveryTransition {
  if (state.status === "idle")
    return open(state.attempt, incident, incident.kind === "unresponsive" && !devtoolsOpen, [])

  if (state.status === "sampling") {
    // A new hang while the sampler still runs keeps the running session.
    if (incident.kind === "unresponsive")
      return {
        state: { status: "dialog", attempt: state.attempt + 1, incident, sample: state.sample },
        commands: [{ type: "reveal" }, { type: "open-dialog", attempt: state.attempt + 1 }],
      }

    return open(state.attempt, incident, false, stopSample(state.sample))
  }

  if (state.status === "dialog") {
    if (PRIORITY[incident.kind] <= PRIORITY[state.incident.kind]) return unchanged(state)

    return open(state.attempt, incident, false, [
      ...stopSample(state.sample),
      { type: "close-dialog", attempt: state.attempt },
    ])
  }

  if (state.incident && PRIORITY[incident.kind] <= PRIORITY[state.incident.kind]) return unchanged(state)

  return {
    state: { ...state, incident, resumeSampling: incident.kind === "unresponsive" && !devtoolsOpen },
    commands: [],
  }
}

function recover(state: Exclude<RecoveryState, { status: "closed" }>): RecoveryTransition {
  if (state.status === "sampling") return { state: idle(state.attempt), commands: stopSample(state.sample) }

  if (state.status === "dialog" && state.incident.kind === "unresponsive")
    return {
      state: idle(state.attempt),
      commands: [...stopSample(state.sample), { type: "close-dialog", attempt: state.attempt }],
    }

  // The export the user asked for still finishes, but no dialog reopens after it.
  if (state.status === "exporting" && state.incident?.kind === "unresponsive")
    return { state: { ...state, incident: undefined, resumeSampling: false }, commands: [] }

  return unchanged(state)
}

function answer(
  state: Exclude<RecoveryState, { status: "closed" }>,
  event: Extract<RecoveryEvent, { type: "dialog.responded" | "dialog.failed" }>,
): RecoveryTransition {
  if (state.status !== "dialog" || state.attempt !== event.attempt) return unchanged(state)

  if (event.type === "dialog.failed")
    return { state: dismiss(state), commands: [{ type: "log-error", kind: "dialog", error: event.error }] }

  if (event.action === "export-logs")
    return {
      state: {
        status: "exporting",
        attempt: state.attempt + 1,
        incident: state.incident,
        resumeSampling: state.sample !== undefined,
      },
      commands: [
        ...stopSample(state.sample),
        { type: "export-logs", attempt: state.attempt + 1 },
        { type: "start-export-timeout", attempt: state.attempt + 1 },
      ],
    }

  if (event.action === "relaunch")
    return { state: CLOSED, commands: [...stopSample(state.sample), { type: "relaunch" }] }

  if (event.action === "quit") return { state: CLOSED, commands: [...stopSample(state.sample), { type: "quit" }] }

  return { state: dismiss(state), commands: [] }
}

function settleExport(
  state: Exclude<RecoveryState, { status: "closed" }>,
  event: Extract<RecoveryEvent, { type: "export.succeeded" | "export.failed" | "export.timed-out" }>,
): RecoveryTransition {
  if (state.status !== "exporting" || state.attempt !== event.attempt) return unchanged(state)

  const commands = exportOutcome(event)

  if (!state.incident) return { state: idle(state.attempt), commands }

  return open(
    state.attempt,
    state.incident,
    state.incident.kind === "unresponsive" && state.resumeSampling && !event.devtoolsOpen,
    commands,
  )
}

function exportOutcome(
  event: Extract<RecoveryEvent, { type: "export.succeeded" | "export.failed" | "export.timed-out" }>,
): RecoveryCommand[] {
  if (event.type === "export.succeeded") return [{ type: "cancel-export-timeout" }]

  if (event.type === "export.failed")
    return [{ type: "cancel-export-timeout" }, { type: "log-error", kind: "export", error: event.error }]

  // The timer already fired, so there is nothing to cancel.
  return [{ type: "log-error", kind: "export-timeout" }]
}

function sample(
  state: Exclude<RecoveryState, { status: "closed" }>,
  event: Extract<RecoveryEvent, { type: `sample.${string}` }>,
): RecoveryTransition {
  if (state.status !== "sampling" && state.status !== "dialog") return unchanged(state)

  const session = state.sample

  if (!session || session.attempt !== event.attempt) return unchanged(state)

  if (event.type === "sample.window-elapsed")
    return {
      state: state.status === "sampling" ? idle(state.attempt) : { ...state, sample: undefined },
      commands: stopSample(session),
    }

  if (event.type === "sample.tick") {
    if (session.collecting) return unchanged(state)

    return {
      state: { ...state, sample: { ...session, collecting: true } },
      commands: [{ type: "collect-sample", attempt: session.attempt }],
    }
  }

  if (!session.collecting) return unchanged(state)

  const tick: RecoveryCommand = { type: "start-sample-tick", attempt: session.attempt }

  if (event.type === "sample.failed")
    return {
      state: { ...state, sample: { ...session, collecting: false } },
      commands: [{ type: "log-error", kind: "sample", error: event.error }, tick],
    }

  return {
    state: {
      ...state,
      sample: {
        ...session,
        collecting: false,
        samples: event.stack
          ? new Map(session.samples).set(event.stack, (session.samples.get(event.stack) ?? 0) + 1)
          : session.samples,
      },
    },
    commands: [tick],
  }
}

// Opens a dialog for `incident` with the next attempt, starting a sampling session first when asked.
function open(
  attempt: number,
  incident: RecoveryIncident,
  sampling: boolean,
  commands: readonly RecoveryCommand[],
): RecoveryTransition {
  const dialog = sampling ? attempt + 2 : attempt + 1

  return {
    state: {
      status: "dialog",
      attempt: dialog,
      incident,
      sample: sampling ? { attempt: attempt + 1, collecting: false, samples: new Map() } : undefined,
    },
    commands: [
      ...commands,
      ...(sampling
        ? [
            { type: "start-sample-tick", attempt: attempt + 1 } as const,
            { type: "start-sample-window", attempt: attempt + 1 } as const,
          ]
        : []),
      { type: "reveal" },
      { type: "open-dialog", attempt: dialog },
    ],
  }
}

function dismiss(state: Extract<RecoveryState, { status: "dialog" }>): RecoveryState {
  return state.sample ? { status: "sampling", attempt: state.attempt, sample: state.sample } : idle(state.attempt)
}

function stopSample(session: SampleSession | undefined): RecoveryCommand[] {
  if (!session) return []

  if (session.samples.size === 0) return [{ type: "cancel-sample-timers" }]

  return [{ type: "cancel-sample-timers" }, { type: "flush-samples", samples: session.samples }]
}

function idle(attempt: number): RecoveryState {
  return { status: "idle", attempt }
}

function unchanged(state: RecoveryState): RecoveryTransition {
  return { state, commands: [] }
}

type RecoveryTimer = "tick" | "window" | "export"

type RecoveryDriverHandles = {
  timers: Record<RecoveryTimer, ReturnType<typeof setTimeout> | undefined>
  dialog:
    | { readonly attempt: number; readonly controller: AbortController; readonly settled: Promise<void> }
    | undefined
}

/** Runs one window's recovery machine and owns its timers, dialog and export. */
export function createRecoveryDriver(input: {
  readonly reveal: () => void
  readonly showDialog: (dialog: RecoveryDialogView, signal: AbortSignal) => Promise<number>
  readonly exportLogs: () => Promise<void>
  readonly collectSample: () => Promise<string | undefined>
  readonly flushSamples: (samples: ReadonlyMap<string, number>) => void
  readonly logError: (failure: RecoveryFailure) => void
  readonly isDevToolsOpen: () => boolean
  readonly isDestroyed: () => boolean
  readonly relaunch: () => void
  readonly quit: () => void
}) {
  const current = { state: initialRecoveryState() }

  const handles: RecoveryDriverHandles = {
    timers: { tick: undefined, window: undefined, export: undefined },
    dialog: undefined,
  }

  const dispatch = (event: RecoveryEvent) => {
    const next = transitionRecovery(current.state, event)

    current.state = next.state
    // One throwing command must not skip the commands after it, such as the dialog after a failed reveal.
    next.commands.forEach((command) =>
      Promise.try(() => perform(command)).catch((error) => input.logError({ kind: "command", error })),
    )
  }

  const arm = (timer: RecoveryTimer, delay: number, event: () => RecoveryEvent) => {
    clearTimeout(handles.timers[timer])
    handles.timers[timer] = setTimeout(() => dispatch(event()), delay)
  }

  const disarm = (timer: RecoveryTimer) => {
    clearTimeout(handles.timers[timer])
    handles.timers[timer] = undefined
  }

  // The window may close while its dialog is open; closing dismisses the dialog with its cancel button (Quit).
  const answered = (controller: AbortController, event: RecoveryEvent) => {
    if (controller.signal.aborted) return

    dispatch(input.isDestroyed() ? { type: "window.closed" } : event)
  }

  // A replacement dialog waits for the one it supersedes to dismiss before it attaches to the window.
  const openDialog = (attempt: number) => {
    const controller = new AbortController()

    const settled = (handles.dialog?.settled ?? Promise.resolve())
      .then(() => {
        const view = selectDialog(current.state)

        if (controller.signal.aborted || view?.attempt !== attempt) return

        if (input.isDestroyed()) return dispatch({ type: "window.closed" })

        return input.showDialog(view, controller.signal).then(
          (response) => answered(controller, { type: "dialog.responded", attempt, action: view.actions[response] }),
          (error) => answered(controller, { type: "dialog.failed", attempt, error }),
        )
      })
      .finally(() => {
        if (handles.dialog?.controller === controller) handles.dialog = undefined
      })

    handles.dialog = { attempt, controller, settled }
  }

  const perform = (command: RecoveryCommand) => {
    switch (command.type) {
      case "reveal":
        return input.reveal()

      case "open-dialog":
        return openDialog(command.attempt)

      case "close-dialog":
        if (handles.dialog?.attempt === command.attempt) handles.dialog.controller.abort()

        return

      case "export-logs":
        return void input.exportLogs().then(
          () => dispatch({ type: "export.succeeded", attempt: command.attempt, devtoolsOpen: input.isDevToolsOpen() }),
          (error) =>
            dispatch({ type: "export.failed", attempt: command.attempt, error, devtoolsOpen: input.isDevToolsOpen() }),
        )

      case "start-export-timeout":
        return arm("export", EXPORT_TIMEOUT_MS, () => ({
          type: "export.timed-out",
          attempt: command.attempt,
          devtoolsOpen: input.isDevToolsOpen(),
        }))

      case "cancel-export-timeout":
        return disarm("export")

      case "start-sample-tick":
        return arm("tick", SAMPLE_INTERVAL_MS, () => ({ type: "sample.tick", attempt: command.attempt }))

      case "start-sample-window":
        return arm("window", SAMPLE_PERIOD_MS, () => ({ type: "sample.window-elapsed", attempt: command.attempt }))

      case "cancel-sample-timers":
        disarm("tick")

        return disarm("window")

      case "collect-sample":
        return void input.collectSample().then(
          (stack) => dispatch({ type: "sample.collected", attempt: command.attempt, stack }),
          (error) => dispatch({ type: "sample.failed", attempt: command.attempt, error }),
        )

      case "flush-samples":
        return input.flushSamples(command.samples)

      case "log-error":
        return input.logError(command)

      case "relaunch":
        return input.relaunch()

      case "quit":
        return input.quit()
    }
  }

  return { state: () => current.state, dispatch }
}
