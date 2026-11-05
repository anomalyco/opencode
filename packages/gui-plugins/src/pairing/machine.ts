/** How long one read of the remote access setting may take. */
export const REMOTE_READ_TIMEOUT_MS = 15_000

/** How many times a failed read of either setting is tried again, as a query's default retries did. */
export const REMOTE_READ_RETRIES = 3

/** The wait before read retry `failures`: 1, 2, then 4 seconds, a query's default backoff. */
export function remoteReadDelay(failures: number) {
  return Math.min(1_000 * 2 ** failures, 30_000)
}

/** How long turning remote access on or off may take: the first time creates the tunnel, which can take a minute. */
export const REMOTE_CHANGE_TIMEOUT_MS = 180_000

/**
 * The service attaches the tunnel in the background after it starts, so the dialog asks again this many times, a
 * second apart, about three minutes, as `opencode pair --remote` waits.
 */
export const TUNNEL_RETRIES = 180

export const TUNNEL_RETRY_DELAY_MS = 1_000

/** How long one request for the server's addresses may take before it counts as one more try. */
export const TUNNEL_TIMEOUT_MS = 10_000

/** How long one request for a pairing code may take. */
export const CODE_TIMEOUT_MS = 15_000

/** How long one read or change of the display sleep setting may take. */
export const SCREEN_TIMEOUT_MS = 15_000

/** Pairing's main side as the page reads it: remote access changes only through it. */
export type MainStatus =
  | { readonly status: "active"; readonly generation: number }
  /** The main side is starting or restarting. */
  | { readonly status: "pending" }
  /** The main side is disabled or failed, or this is the web. */
  | { readonly status: "inactive" }

/** The remote access setting, read and changed through one generation of pairing's main side. */
export type RemoteState =
  | { readonly status: "pending" }
  | { readonly status: "inactive" }
  | {
      readonly status: "loading"
      readonly generation: number
      readonly attempt: number
      /** A read runs, or the wait before the next read after a failure. */
      readonly step: "reading" | "waiting"
      readonly failures: number
    }
  | { readonly status: "ready"; readonly generation: number; readonly enabled: boolean }
  | {
      readonly status: "changing"
      readonly generation: number
      readonly attempt: number
      readonly enabled: boolean
      /** Restarts the service even when the setting already matches, as a tunnel that never connected needs. */
      readonly restart: boolean
      /** The setting before the change, when it was known. */
      readonly previous: boolean | undefined
    }
  | { readonly status: "failed"; readonly generation: number; readonly previous: boolean | undefined }
  | { readonly status: "disposed" }

/** Whether main keeps the display awake, read and changed through one generation of pairing's main side. */
export type ScreenState =
  | { readonly status: "pending" }
  | { readonly status: "inactive" }
  | {
      readonly status: "loading"
      readonly generation: number
      readonly attempt: number
      /** A read runs, or the wait before the next read after a failure. */
      readonly step: "reading" | "waiting"
      readonly failures: number
    }
  | { readonly status: "ready"; readonly generation: number; readonly enabled: boolean }
  | {
      readonly status: "changing"
      readonly generation: number
      readonly attempt: number
      readonly enabled: boolean
      /** The setting before the change, when it was known. */
      readonly previous: boolean | undefined
    }
  | { readonly status: "failed"; readonly generation: number; readonly previous: boolean | undefined }
  | { readonly status: "disposed" }

/** The "Pair a device" dialog. Exactly one variant owns its body. */
export type DialogState =
  | { readonly status: "closed" }
  /** Neither the local server nor pairing's main side can set up pairing. */
  | { readonly status: "unavailable" }
  /** Remote access is being read or turned on. */
  | { readonly status: "turning-on" }
  /** Remote access is on; the dialog asks the server for its tunnel address until it advertises one. */
  | {
      readonly status: "tunnel"
      readonly attempt: number
      readonly step: "polling" | "waiting"
      readonly retries: number
    }
  | { readonly status: "code"; readonly attempt: number; readonly tunnel: string }
  | {
      readonly status: "ready"
      readonly tunnel: string
      readonly code: string
      readonly url: string
      readonly expiresIn: number
      readonly loadedAt: number
      /** The attempt fetching the next code while this one stays on screen. */
      readonly refreshing: number | undefined
    }
  | { readonly status: "code-error"; readonly tunnel: string }
  | { readonly status: "failed"; readonly reason: "remote" | "tunnel" }

/**
 * The pairing page: the remote access setting, the dialog that turns it on, and the display sleep setting. One
 * transition owns them, so the dialog follows every change of remote access in the same event, and both settings
 * follow main's generations together. `issued` is the last attempt handed out.
 */
export type PairingState = {
  readonly issued: number
  /** Whether the local server is listed. Codes come from it, so they never wait for main. */
  readonly server: boolean
  readonly remote: RemoteState
  readonly screen: ScreenState
  readonly dialog: DialogState
}

export type PairingEvent =
  | { readonly type: "main.changed"; readonly main: MainStatus }
  | { readonly type: "server.changed"; readonly available: boolean }
  | { readonly type: "read.succeeded"; readonly attempt: number; readonly enabled: boolean }
  /** The read failed or timed out. */
  | { readonly type: "read.failed"; readonly attempt: number }
  /** The user flipped the remote access switch. */
  | { readonly type: "toggled"; readonly enabled: boolean }
  | { readonly type: "change.succeeded"; readonly attempt: number }
  /** The change failed or timed out. */
  | { readonly type: "change.failed"; readonly attempt: number }
  | { readonly type: "screen.read.succeeded"; readonly attempt: number; readonly enabled: boolean }
  /** The display sleep setting's read failed or timed out. */
  | { readonly type: "screen.read.failed"; readonly attempt: number }
  /** The user flipped the "Keep screen active" switch. */
  | { readonly type: "screen.toggled"; readonly enabled: boolean }
  | { readonly type: "screen.change.succeeded"; readonly attempt: number }
  /** The display sleep setting's change failed or timed out. */
  | { readonly type: "screen.change.failed"; readonly attempt: number }
  /** The user clicked "Pair device". */
  | { readonly type: "dialog.opened" }
  | { readonly type: "dialog.closed" }
  | { readonly type: "tunnel.found"; readonly attempt: number; readonly tunnel: string }
  /** The server advertises no tunnel yet, or the request failed or timed out. */
  | { readonly type: "tunnel.missing"; readonly attempt: number }
  /** A `wait` effect's delay ended; `for` names the phase it belongs to, as the effect did. */
  | { readonly type: "wait.ended"; readonly for: "read" | "screen" | "tunnel"; readonly attempt: number }
  | {
      readonly type: "code.loaded"
      readonly attempt: number
      readonly code: string
      readonly expiresIn: number
      readonly now: number
    }
  /** The code request failed or timed out. */
  | { readonly type: "code.failed"; readonly attempt: number }
  | { readonly type: "code.refresh" }
  | { readonly type: "retry" }
  /** The dialog's clock: a code that expired, even while the window slept, is replaced. */
  | { readonly type: "tick"; readonly now: number }
  | { readonly type: "disposed" }

export type PairingEffect =
  | { readonly type: "read-remote"; readonly generation: number; readonly attempt: number; readonly timeoutMs: number }
  | {
      readonly type: "set-remote"
      readonly generation: number
      readonly attempt: number
      readonly enabled: boolean
      readonly restart: boolean
      readonly timeoutMs: number
    }
  | { readonly type: "read-screen"; readonly generation: number; readonly attempt: number; readonly timeoutMs: number }
  | {
      readonly type: "set-screen"
      readonly generation: number
      readonly attempt: number
      readonly enabled: boolean
      readonly timeoutMs: number
    }
  | { readonly type: "poll-tunnel"; readonly attempt: number; readonly timeoutMs: number }
  /**
   * Waits before the next read of a setting or the next ask for the tunnel; ends with `wait.ended` for the same
   * phase, so retries that wait at once never take each other's event.
   */
  | {
      readonly type: "wait"
      readonly for: "read" | "screen" | "tunnel"
      readonly attempt: number
      readonly delayMs: number
    }
  | { readonly type: "fetch-code"; readonly attempt: number; readonly timeoutMs: number }
  /** Ends an attempt's request and timer. */
  | { readonly type: "abort"; readonly attempt: number }
  | { readonly type: "open-dialog" }
  | { readonly type: "close-dialog" }

export type PairingTransition = { readonly state: PairingState; readonly effects: readonly PairingEffect[] }

const NONE: readonly PairingEffect[] = []

export function createPairingState(): PairingState {
  return {
    issued: 0,
    server: false,
    remote: { status: "pending" },
    screen: { status: "pending" },
    dialog: { status: "closed" },
  }
}

export function transitionPairing(state: PairingState, event: PairingEvent): PairingTransition {
  const remote = state.remote
  const screen = state.screen
  const dialog = state.dialog

  if (remote.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") {
    const close: readonly PairingEffect[] = dialog.status === "closed" ? [] : [{ type: "close-dialog" }]

    return {
      state: { ...state, remote: { status: "disposed" }, screen: { status: "disposed" }, dialog: { status: "closed" } },
      effects: [...abortRemote(remote), ...abortScreen(screen), ...abortDialog(dialog), ...close],
    }
  }

  if (event.type === "main.changed") {
    const main = event.main

    if (main.status !== "active") {
      if (remote.status === main.status && screen.status === main.status) return { state, effects: NONE }

      return settle({ ...state, remote: { status: main.status }, screen: { status: main.status } }, [
        ...abortRemote(remote),
        ...abortScreen(screen),
      ])
    }

    if (
      "generation" in remote &&
      remote.generation === main.generation &&
      "generation" in screen &&
      screen.generation === main.generation
    )
      return { state, effects: NONE }

    const attempt = state.issued + 1
    // Both settings are read again through the new generation, so neither keeps an answer or error from the last one.
    const screenAttempt = attempt + 1

    return settle(
      {
        ...state,
        issued: screenAttempt,
        remote: { status: "loading", generation: main.generation, attempt, step: "reading", failures: 0 },
        screen: {
          status: "loading",
          generation: main.generation,
          attempt: screenAttempt,
          step: "reading",
          failures: 0,
        },
      },
      [
        ...abortRemote(remote),
        ...abortScreen(screen),
        { type: "read-remote", generation: main.generation, attempt, timeoutMs: REMOTE_READ_TIMEOUT_MS },
        { type: "read-screen", generation: main.generation, attempt: screenAttempt, timeoutMs: SCREEN_TIMEOUT_MS },
      ],
    )
  }

  if (
    event.type === "screen.read.succeeded" ||
    event.type === "screen.read.failed" ||
    event.type === "screen.toggled" ||
    event.type === "screen.change.succeeded" ||
    event.type === "screen.change.failed" ||
    (event.type === "wait.ended" && event.for === "screen")
  )
    return transitionScreen(state, event)

  if (event.type === "server.changed") {
    if (state.server === event.available) return { state, effects: NONE }

    return settle({ ...state, server: event.available }, NONE)
  }

  if (event.type === "read.succeeded" || event.type === "read.failed") {
    if (remote.status !== "loading" || remote.step !== "reading" || remote.attempt !== event.attempt)
      return { state, effects: NONE }

    const effects: readonly PairingEffect[] = [{ type: "abort", attempt: event.attempt }]

    if (event.type === "read.succeeded")
      return settle(
        { ...state, remote: { status: "ready", generation: remote.generation, enabled: event.enabled } },
        effects,
      )

    if (remote.failures >= REMOTE_READ_RETRIES)
      return settle(
        { ...state, remote: { status: "failed", generation: remote.generation, previous: undefined } },
        effects,
      )

    const attempt = state.issued + 1

    return {
      state: {
        ...state,
        issued: attempt,
        remote: { ...remote, attempt, step: "waiting", failures: remote.failures + 1 },
      },
      effects: [...effects, { type: "wait", for: "read", attempt, delayMs: remoteReadDelay(remote.failures) }],
    }
  }

  if (event.type === "wait.ended" && event.for === "read") {
    if (remote.status !== "loading" || remote.step !== "waiting" || remote.attempt !== event.attempt)
      return { state, effects: NONE }

    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, remote: { ...remote, attempt, step: "reading" } },
      effects: [
        { type: "abort", attempt: event.attempt },
        { type: "read-remote", generation: remote.generation, attempt, timeoutMs: REMOTE_READ_TIMEOUT_MS },
      ],
    }
  }

  if (event.type === "toggled") {
    if (remote.status === "ready" && remote.enabled !== event.enabled)
      return settle(...change(state, NONE, event.enabled, false))

    // A change reads the setting before it writes, so the switch also works after a read that never answered.
    if (remote.status === "failed") return settle(...change(state, NONE, event.enabled, false))

    return { state, effects: NONE }
  }

  if (event.type === "change.succeeded" || event.type === "change.failed") {
    if (remote.status !== "changing" || remote.attempt !== event.attempt) return { state, effects: NONE }

    return settle(
      {
        ...state,
        remote:
          event.type === "change.succeeded"
            ? { status: "ready", generation: remote.generation, enabled: remote.enabled }
            : { status: "failed", generation: remote.generation, previous: remote.previous },
      },
      [{ type: "abort", attempt: event.attempt }],
    )
  }

  if (event.type === "dialog.opened") {
    if (dialog.status !== "closed") return { state, effects: NONE }

    const opened: PairingState = { ...state, dialog: { status: "turning-on" } }
    const effects: readonly PairingEffect[] = [{ type: "open-dialog" }]

    // Every pairing goes through remote access, so opening the dialog tries again after a failure.
    if (remote.status === "failed") return settle(...change(opened, effects, true, false))

    return settle(opened, effects)
  }

  if (event.type === "dialog.closed") return toDialog(state, NONE, { status: "closed" })

  if (event.type === "retry") {
    if (dialog.status !== "failed") return { state, effects: NONE }

    const retrying: PairingState = { ...state, dialog: { status: "turning-on" } }

    // A tunnel that never connected comes back when the service starts it again.
    if (remote.status === "ready" || remote.status === "failed")
      return settle(...change(retrying, NONE, true, dialog.reason === "tunnel"))

    return settle(retrying, NONE)
  }

  return transitionCode(state, event)
}

/**
 * The display sleep setting. It reads and retries as remote access does, and stays switchable after a failure, so
 * flipping the switch is the way to try again. Nothing else depends on it.
 */
function transitionScreen(
  state: PairingState,
  event: Extract<
    PairingEvent,
    {
      type:
        | "screen.read.succeeded"
        | "screen.read.failed"
        | "screen.toggled"
        | "screen.change.succeeded"
        | "screen.change.failed"
        | "wait.ended"
    }
  >,
): PairingTransition {
  const screen = state.screen
  const attempt = state.issued + 1

  if (event.type === "screen.read.succeeded" || event.type === "screen.read.failed") {
    if (screen.status !== "loading" || screen.step !== "reading" || screen.attempt !== event.attempt)
      return { state, effects: NONE }

    const effects: readonly PairingEffect[] = [{ type: "abort", attempt: event.attempt }]

    if (event.type === "screen.read.succeeded")
      return {
        state: { ...state, screen: { status: "ready", generation: screen.generation, enabled: event.enabled } },
        effects,
      }

    if (screen.failures >= REMOTE_READ_RETRIES)
      return {
        state: { ...state, screen: { status: "failed", generation: screen.generation, previous: undefined } },
        effects,
      }

    return {
      state: { ...state, issued: attempt, screen: { ...screen, attempt, step: "waiting", failures: screen.failures + 1 } },
      effects: [...effects, { type: "wait", for: "screen", attempt, delayMs: remoteReadDelay(screen.failures) }],
    }
  }

  if (event.type === "wait.ended") {
    if (screen.status !== "loading" || screen.step !== "waiting" || screen.attempt !== event.attempt)
      return { state, effects: NONE }

    return {
      state: { ...state, issued: attempt, screen: { ...screen, attempt, step: "reading" } },
      effects: [
        { type: "abort", attempt: event.attempt },
        { type: "read-screen", generation: screen.generation, attempt, timeoutMs: SCREEN_TIMEOUT_MS },
      ],
    }
  }

  if (event.type === "screen.toggled") {
    if (screen.status !== "ready" && screen.status !== "failed") return { state, effects: NONE }

    if (screen.status === "ready" && screen.enabled === event.enabled) return { state, effects: NONE }

    return {
      state: {
        ...state,
        issued: attempt,
        screen: {
          status: "changing",
          generation: screen.generation,
          attempt,
          enabled: event.enabled,
          previous: screen.status === "ready" ? screen.enabled : screen.previous,
        },
      },
      effects: [
        {
          type: "set-screen",
          generation: screen.generation,
          attempt,
          enabled: event.enabled,
          timeoutMs: SCREEN_TIMEOUT_MS,
        },
      ],
    }
  }

  if (screen.status !== "changing" || screen.attempt !== event.attempt) return { state, effects: NONE }

  return {
    state: {
      ...state,
      screen:
        event.type === "screen.change.succeeded"
          ? { status: "ready", generation: screen.generation, enabled: screen.enabled }
          : { status: "failed", generation: screen.generation, previous: screen.previous },
    },
    effects: [{ type: "abort", attempt: event.attempt }],
  }
}

/** The dialog's own requests: the tunnel address, then the code and its replacements. */
function transitionCode(state: PairingState, event: PairingEvent): PairingTransition {
  const dialog = state.dialog
  const attempt = state.issued + 1

  if (event.type === "tunnel.found") {
    if (dialog.status !== "tunnel" || dialog.step !== "polling" || dialog.attempt !== event.attempt)
      return { state, effects: NONE }

    return {
      state: { ...state, issued: attempt, dialog: { status: "code", attempt, tunnel: event.tunnel } },
      effects: [
        { type: "abort", attempt: event.attempt },
        { type: "fetch-code", attempt, timeoutMs: CODE_TIMEOUT_MS },
      ],
    }
  }

  if (event.type === "tunnel.missing") {
    if (dialog.status !== "tunnel" || dialog.step !== "polling" || dialog.attempt !== event.attempt)
      return { state, effects: NONE }

    if (dialog.retries >= TUNNEL_RETRIES)
      return { state: { ...state, dialog: { status: "failed", reason: "tunnel" } }, effects: abortDialog(dialog) }

    return {
      state: {
        ...state,
        issued: attempt,
        dialog: { status: "tunnel", attempt, step: "waiting", retries: dialog.retries + 1 },
      },
      effects: [
        { type: "abort", attempt: event.attempt },
        { type: "wait", for: "tunnel", attempt, delayMs: TUNNEL_RETRY_DELAY_MS },
      ],
    }
  }

  if (event.type === "wait.ended" && event.for === "tunnel") {
    if (dialog.status !== "tunnel" || dialog.step !== "waiting" || dialog.attempt !== event.attempt)
      return { state, effects: NONE }

    return {
      state: {
        ...state,
        issued: attempt,
        dialog: { status: "tunnel", attempt, step: "polling", retries: dialog.retries },
      },
      effects: [
        { type: "abort", attempt: event.attempt },
        { type: "poll-tunnel", attempt, timeoutMs: TUNNEL_TIMEOUT_MS },
      ],
    }
  }

  if (event.type === "code.loaded" || event.type === "code.failed") {
    const current =
      (dialog.status === "code" && dialog.attempt === event.attempt) ||
      (dialog.status === "ready" && dialog.refreshing === event.attempt)

    if (!current) return { state, effects: NONE }

    const url = event.type === "code.loaded" ? URL.parse(`/auth/connect/${event.code}`, dialog.tunnel)?.href : undefined

    return {
      state: {
        ...state,
        dialog:
          event.type === "code.loaded" && url
            ? {
                status: "ready",
                tunnel: dialog.tunnel,
                code: event.code,
                url,
                expiresIn: event.expiresIn,
                loadedAt: event.now,
                refreshing: undefined,
              }
            : { status: "code-error", tunnel: dialog.tunnel },
      },
      effects: [{ type: "abort", attempt: event.attempt }],
    }
  }

  if (event.type === "code.refresh") {
    if (dialog.status === "code-error")
      return {
        state: { ...state, issued: attempt, dialog: { status: "code", attempt, tunnel: dialog.tunnel } },
        effects: [{ type: "fetch-code", attempt, timeoutMs: CODE_TIMEOUT_MS }],
      }

    if (dialog.status !== "ready" || dialog.refreshing !== undefined) return { state, effects: NONE }

    return refreshCode(state, dialog)
  }

  if (event.type === "tick") {
    // Codes are single-use, so replace the link as soon as the server forgets the current code.
    if (dialog.status !== "ready" || dialog.refreshing !== undefined || remainingSeconds(dialog, event.now) > 0)
      return { state, effects: NONE }

    return refreshCode(state, dialog)
  }

  return { state, effects: NONE }
}

function refreshCode(state: PairingState, dialog: Extract<DialogState, { status: "ready" }>): PairingTransition {
  const attempt = state.issued + 1

  return {
    state: { ...state, issued: attempt, dialog: { ...dialog, refreshing: attempt } },
    effects: [{ type: "fetch-code", attempt, timeoutMs: CODE_TIMEOUT_MS }],
  }
}

/** Turns remote access on or off; the caller checked that no read or change is in flight. */
function change(
  state: PairingState,
  effects: readonly PairingEffect[],
  enabled: boolean,
  restart: boolean,
): [PairingState, readonly PairingEffect[]] {
  const remote = state.remote

  if (remote.status !== "ready" && remote.status !== "failed") return [state, effects]

  const attempt = state.issued + 1

  return [
    {
      ...state,
      issued: attempt,
      remote: {
        status: "changing",
        generation: remote.generation,
        attempt,
        enabled,
        restart,
        previous: remote.status === "ready" ? remote.enabled : remote.previous,
      },
    },
    [
      ...effects,
      {
        type: "set-remote",
        generation: remote.generation,
        attempt,
        enabled,
        restart,
        timeoutMs: REMOTE_CHANGE_TIMEOUT_MS,
      },
    ],
  ]
}

/** Moves an open dialog to the phase that follows from remote access and the server, after either changed. */
function settle(state: PairingState, effects: readonly PairingEffect[]): PairingTransition {
  const dialog = state.dialog
  const remote = state.remote

  if (dialog.status === "closed") return { state, effects }

  // Codes and the tunnel address come from the local server.
  if (!state.server) return toDialog(state, effects, { status: "unavailable" })

  if (
    dialog.status === "tunnel" ||
    dialog.status === "code" ||
    dialog.status === "ready" ||
    dialog.status === "code-error"
  ) {
    if (remote.status === "failed") return toDialog(state, effects, { status: "failed", reason: "remote" })

    // Main going away or restarting is a suspension: the code needs only the server.
    if (remote.status !== "changing" && !(remote.status === "ready" && !remote.enabled)) return { state, effects }

    return setUp(state, effects)
  }

  if (dialog.status === "failed") {
    if (remote.status === "inactive") return toDialog(state, effects, { status: "unavailable" })

    if (remote.status === "changing") return toDialog(state, effects, { status: "turning-on" })

    if (remote.status === "failed") return toDialog(state, effects, { status: "failed", reason: "remote" })

    // A tunnel that never connected waits for "Try again", which restarts the service.
    if (dialog.reason === "remote" && remote.status === "ready" && remote.enabled) return startTunnel(state, effects)

    return { state, effects }
  }

  return setUp(state, effects)
}

function setUp(state: PairingState, effects: readonly PairingEffect[]): PairingTransition {
  const remote = state.remote

  if (remote.status === "inactive") return toDialog(state, effects, { status: "unavailable" })

  if (remote.status === "failed") return toDialog(state, effects, { status: "failed", reason: "remote" })

  if (remote.status === "ready" && remote.enabled) return startTunnel(state, effects)

  if (remote.status === "ready") return toDialog(...change(state, effects, true, false), { status: "turning-on" })

  return toDialog(state, effects, { status: "turning-on" })
}

function startTunnel(state: PairingState, effects: readonly PairingEffect[]): PairingTransition {
  const attempt = state.issued + 1

  return {
    state: { ...state, issued: attempt, dialog: { status: "tunnel", attempt, step: "polling", retries: 0 } },
    effects: [...effects, ...abortDialog(state.dialog), { type: "poll-tunnel", attempt, timeoutMs: TUNNEL_TIMEOUT_MS }],
  }
}

function toDialog(
  state: PairingState,
  effects: readonly PairingEffect[],
  next: Extract<DialogState, { status: "closed" | "unavailable" | "turning-on" | "failed" }>,
): PairingTransition {
  const dialog = state.dialog

  const same =
    dialog.status === "failed"
      ? next.status === "failed" && dialog.reason === next.reason
      : dialog.status === next.status

  if (same) return { state, effects }

  return { state: { ...state, dialog: next }, effects: [...effects, ...abortDialog(dialog)] }
}

function abortRemote(remote: RemoteState): readonly PairingEffect[] {
  return remote.status === "loading" || remote.status === "changing" ? [{ type: "abort", attempt: remote.attempt }] : []
}

function abortScreen(screen: ScreenState): readonly PairingEffect[] {
  return screen.status === "loading" || screen.status === "changing" ? [{ type: "abort", attempt: screen.attempt }] : []
}

function abortDialog(dialog: DialogState): readonly PairingEffect[] {
  if (dialog.status === "tunnel" || dialog.status === "code") return [{ type: "abort", attempt: dialog.attempt }]

  if (dialog.status === "ready" && dialog.refreshing !== undefined)
    return [{ type: "abort", attempt: dialog.refreshing }]

  return []
}

/** The event that reports an effect that threw before it could answer, so its phase still ends. */
export function pairingEffectFailed(effect: PairingEffect): PairingEvent | undefined {
  if (effect.type === "read-remote") return { type: "read.failed", attempt: effect.attempt }

  if (effect.type === "set-remote") return { type: "change.failed", attempt: effect.attempt }

  if (effect.type === "read-screen") return { type: "screen.read.failed", attempt: effect.attempt }

  if (effect.type === "set-screen") return { type: "screen.change.failed", attempt: effect.attempt }

  if (effect.type === "poll-tunnel") return { type: "tunnel.missing", attempt: effect.attempt }

  if (effect.type === "wait") return { type: "wait.ended", for: effect.for, attempt: effect.attempt }

  if (effect.type === "fetch-code") return { type: "code.failed", attempt: effect.attempt }

  if (effect.type === "open-dialog") return { type: "dialog.closed" }

  return undefined
}

/** What the pairing settings page shows. */
export function viewPairingPage(state: PairingState) {
  const remote = state.remote
  const screen = state.screen
  const mainActive = remote.status !== "pending" && remote.status !== "inactive" && remote.status !== "disposed"

  return {
    mainActive,
    pairDisabled: !mainActive || !state.server || (remote.status === "changing" && !remote.enabled),
    // A change shows its target; a failed one shows the setting it left.
    remoteChecked:
      ((remote.status === "changing" || remote.status === "ready") && remote.enabled) ||
      (remote.status === "failed" && remote.previous === true),
    remoteDisabled: remote.status !== "ready" && remote.status !== "failed",
    remoteError: remote.status === "failed",
    screenChecked:
      ((screen.status === "changing" || screen.status === "ready") && screen.enabled) ||
      (screen.status === "failed" && screen.previous === true),
    // A failed read or change keeps the switch enabled, so flipping it tries again.
    screenDisabled: screen.status !== "ready" && screen.status !== "failed",
    screenError: screen.status === "failed",
    // Pending main is still starting; anything else that leaves it inactive keeps pairing from turning on.
    unavailable: remote.status === "inactive" || !state.server,
  }
}

export type DialogView =
  | { readonly kind: "unavailable" }
  /** `setup` says remote access is still being set up, rather than a code loading. */
  | { readonly kind: "loading"; readonly setup: boolean }
  | {
      readonly kind: "ready"
      readonly url: string
      /** The QR code's content, as `opencode pair --remote` prints it: {"code","urls"} JSON the app's scanner reads. */
      readonly qr: string
      readonly refreshing: boolean
    }
  | { readonly kind: "code-error" }
  | { readonly kind: "failed" }

export function viewDialog(dialog: DialogState): DialogView {
  if (dialog.status === "turning-on" || dialog.status === "tunnel") return { kind: "loading", setup: true }

  if (dialog.status === "code") return { kind: "loading", setup: false }

  if (dialog.status === "ready")
    return {
      kind: "ready",
      url: dialog.url,
      qr: JSON.stringify({ code: dialog.code, urls: [dialog.tunnel] }),
      refreshing: dialog.refreshing !== undefined,
    }

  if (dialog.status === "code-error") return { kind: "code-error" }

  if (dialog.status === "failed") return { kind: "failed" }

  return { kind: "unavailable" }
}

/** The link the dialog shows, which the copy button copies. */
export function dialogUrl(dialog: DialogState) {
  return dialog.status === "ready" ? dialog.url : undefined
}

/** Whole seconds until the shown code expires. */
export function remainingSeconds(dialog: DialogState, now: number) {
  if (dialog.status !== "ready") return 0

  // The clock can lag a fresh code by up to a second; a negative age would show one second too many.
  return Math.max(0, dialog.expiresIn - Math.floor(Math.max(0, now - dialog.loadedAt) / 1000))
}
