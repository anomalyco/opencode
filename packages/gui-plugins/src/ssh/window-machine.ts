import type { SshConfig, SshItem } from "./contract"

/** Who shows the attempt's prompts: nobody yet, a prompt dialog whose chunk is loading, or an open dialog. */
export type SshDialogSlot = "none" | "loading" | "owned"

type Waiter = (ready: boolean) => void

/**
 * This window's connect attempt for one server. `starting` and `answering` wait on a call to main; `waiting` follows
 * main's state until the server is ready, fails, or stops. `attempt` fences the call results: a result for any other
 * attempt is stale. `waiters` are told once, whichever way the attempt ends. `failed` is a call that failed; it
 * shows as an error until the next attempt.
 */
export type SshAttemptState =
  | {
      readonly status: "starting"
      readonly attempt: number
      readonly dialog: SshDialogSlot
      readonly waiters: readonly Waiter[]
    }
  | {
      readonly status: "waiting"
      readonly attempt: number
      readonly dialog: SshDialogSlot
      /** The prompt this window answered; main has not asked anything since. */
      readonly answered?: string
      /** The last answer failed to reach main. */
      readonly error: boolean
      readonly waiters: readonly Waiter[]
    }
  | {
      readonly status: "answering"
      readonly attempt: number
      readonly dialog: SshDialogSlot
      readonly prompt: string
      readonly waiters: readonly Waiter[]
    }
  | { readonly status: "failed" }

type Active = Exclude<SshAttemptState, { status: "failed" }>

export type SshWindowState = {
  readonly status: "open" | "disposed"
  readonly issued: number
  readonly attempts: ReadonlyMap<string, SshAttemptState>
  /** Saved servers this window has seen, each restored once. */
  readonly restored: ReadonlySet<string>
}

export type SshWindowEvent =
  | {
      readonly type: "connect.requested"
      readonly config: SshConfig
      readonly ipcActive: boolean
      readonly item?: SshItem
      readonly dialog?: boolean
      readonly replace?: boolean
      readonly onConnected?: Waiter
    }
  | { readonly type: "start.confirmed"; readonly id: string; readonly attempt: number; readonly item?: SshItem }
  | { readonly type: "start.failed"; readonly id: string; readonly attempt: number }
  | {
      readonly type: "respond.requested"
      readonly id: string
      readonly prompt: string
      readonly value: string
      readonly ipcActive: boolean
      readonly item?: SshItem
    }
  | { readonly type: "respond.succeeded"; readonly id: string; readonly attempt: number; readonly item?: SshItem }
  | { readonly type: "respond.failed"; readonly id: string; readonly attempt: number }
  | { readonly type: "dialog.loading"; readonly id: string; readonly attempt: number }
  | { readonly type: "dialog.opened"; readonly id: string; readonly attempt: number }
  | { readonly type: "dialog.failed"; readonly id: string; readonly attempt: number; readonly saved: boolean }
  | { readonly type: "cancel.requested"; readonly id: string; readonly saved: boolean }
  | { readonly type: "items.synced"; readonly ipcActive: boolean; readonly items: readonly SshItem[] }
  | { readonly type: "disposed" }

export type SshWindowEffect =
  | {
      readonly type: "rpc.start"
      readonly id: string
      readonly attempt: number
      readonly config: SshConfig
      readonly replace: boolean
    }
  | {
      readonly type: "rpc.respond"
      readonly id: string
      readonly attempt: number
      readonly prompt: string
      readonly value: string
    }
  | { readonly type: "rpc.cancel"; readonly id: string; readonly forget: boolean }
  | { readonly type: "rpc.restore"; readonly config: SshConfig }
  | { readonly type: "task.abort"; readonly id: string }
  | { readonly type: "toast.error" }
  | { readonly type: "waiters.notify"; readonly waiters: readonly Waiter[]; readonly ready: boolean }

export type SshWindowTransition = {
  readonly state: SshWindowState
  readonly effects: readonly SshWindowEffect[]
}

export function createSshWindowState(): SshWindowState {
  return { status: "open", issued: 0, attempts: new Map(), restored: new Set() }
}

export function transitionSshWindow(state: SshWindowState, event: SshWindowEvent): SshWindowTransition {
  if (state.status === "disposed") {
    if (event.type === "connect.requested" && event.onConnected)
      return { state, effects: [notify([event.onConnected], false)] }

    return unchanged(state)
  }

  if (event.type === "disposed") {
    const active = [...state.attempts.values()].filter(isActive)

    return {
      state: { ...state, status: "disposed", attempts: new Map() },
      effects: [
        ...[...state.attempts].flatMap(([id, attempt]) => (isCalling(attempt) ? [abort(id)] : [])),
        ...notifyAll(
          active.flatMap((attempt) => attempt.waiters),
          false,
        ),
      ],
    }
  }

  if (event.type === "items.synced") return synced(state, event.ipcActive, event.items)

  if (event.type === "connect.requested") return connect(state, event)

  const current = state.attempts.get(event.id)

  if (event.type === "cancel.requested") {
    const effects: SshWindowEffect[] = [{ type: "rpc.cancel", id: event.id, forget: !event.saved }]

    if (!current) return { state, effects }

    return {
      state: remove(state, event.id),
      effects: [
        ...(isCalling(current) ? [abort(event.id)] : []),
        ...(isActive(current) ? notifyAll(current.waiters, false) : []),
        ...effects,
      ],
    }
  }

  if (event.type === "respond.requested") {
    if (current?.status !== "waiting") return unchanged(state)

    // Without the main side nothing can answer: the attempt fails at once, as one main rejects.
    if (!event.ipcActive)
      return {
        state: put(state, event.id, { status: "failed" }),
        effects: [{ type: "toast.error" }, ...notifyAll(current.waiters, false)],
      }

    if (event.item?.prompt?.id !== event.prompt || (current.answered === event.prompt && !current.error))
      return unchanged(state)
    const attempt = state.issued + 1

    return {
      state: put({ ...state, issued: attempt }, event.id, {
        status: "answering",
        attempt,
        dialog: current.dialog,
        prompt: event.prompt,
        waiters: current.waiters,
      }),
      effects: [{ type: "rpc.respond", id: event.id, attempt, prompt: event.prompt, value: event.value }],
    }
  }

  if (!current || current.status === "failed" || current.attempt !== event.attempt) return unchanged(state)

  if (event.type === "start.confirmed") {
    if (current.status !== "starting") return unchanged(state)

    return wait(state, event.id, { ...current, status: "waiting", error: false }, event.item)
  }

  if (event.type === "start.failed") {
    if (current.status !== "starting") return unchanged(state)

    return {
      state: put(state, event.id, { status: "failed" }),
      effects: [...notifyAll(current.waiters, false), ...(current.dialog === "none" ? [toast] : [])],
    }
  }

  if (event.type === "respond.succeeded") {
    if (current.status !== "answering") return unchanged(state)

    return wait(
      state,
      event.id,
      {
        status: "waiting",
        attempt: current.attempt,
        dialog: current.dialog,
        answered: current.prompt,
        error: false,
        waiters: current.waiters,
      },
      event.item,
    )
  }

  if (event.type === "respond.failed") {
    if (current.status !== "answering") return unchanged(state)

    return {
      state: put(state, event.id, {
        status: "waiting",
        attempt: current.attempt,
        dialog: current.dialog,
        error: true,
        waiters: current.waiters,
      }),
      effects: current.dialog === "none" ? [toast] : [],
    }
  }

  if (current.status !== "waiting") return unchanged(state)

  if (event.type === "dialog.loading") {
    if (current.dialog !== "none") return unchanged(state)

    return { state: put(state, event.id, { ...current, dialog: "loading" }), effects: [] }
  }

  if (current.dialog !== "loading") return unchanged(state)

  if (event.type === "dialog.opened")
    return { state: put(state, event.id, { ...current, dialog: "owned" }), effects: [] }

  // The prompt dialog could not load: nobody can answer, so the attempt ends instead of waiting forever.
  return {
    state: put(state, event.id, { status: "failed" }),
    effects: [...notifyAll(current.waiters, false), toast, { type: "rpc.cancel", id: event.id, forget: !event.saved }],
  }
}

/** A call to main for the attempt is in flight. */
export function selectSshSubmitting(state: SshWindowState, id: string) {
  const attempt = state.attempts.get(id)

  return attempt?.status === "starting" || attempt?.status === "answering"
}

export function selectSshError(state: SshWindowState, id: string) {
  const attempt = state.attempts.get(id)

  return attempt?.status === "failed" || (attempt?.status === "waiting" && attempt.error)
}

/** This window answered the prompt main shows now. */
export function selectSshAnswered(state: SshWindowState, id: string, item: SshItem | undefined) {
  const attempt = state.attempts.get(id)

  return !!item?.prompt && attempt?.status === "waiting" && !attempt.error && attempt.answered === item.prompt.id
}

/** The server connects, here or in another window, and a new connect would only join it. */
export function selectSshPending(state: SshWindowState, id: string, item: SshItem | undefined) {
  return selectSshSubmitting(state, id) || !!item?.authenticatingElsewhere || item?.stage === "connecting"
}

/** The next attempt whose prompt or update step needs a dialog of its own, while no other dialog shows. */
export function selectSshPromptTarget(state: SshWindowState, items: readonly SshItem[]) {
  return items.flatMap((item) => {
    const attempt = state.attempts.get(item.config.id)

    return attempt?.status === "waiting" &&
      attempt.dialog === "none" &&
      !attempt.error &&
      (item.prompt || item.stage === "incompatible")
      ? [{ item, attempt: attempt.attempt }]
      : []
  })[0]
}

/** The prompt dialog may open for the attempt: it is still the one that started loading it. */
export function selectSshCanOpenDialog(state: SshWindowState, id: string, attempt: number) {
  const current = state.attempts.get(id)

  return current?.status === "waiting" && current.attempt === attempt && current.dialog === "loading"
}

/**
 * Whether asking main for the server's endpoint can answer now. While main is gone, or the server waits for the
 * user (disconnected, signing in here, incompatible, or failed for good), a call would only return `null`.
 */
export function selectSshResolvable(ipcActive: boolean, item: SshItem | undefined) {
  if (!ipcActive || !item) return false

  return (
    item.stage === "ready" ||
    item.stage === "connecting" ||
    !!item.authenticatingElsewhere ||
    (item.stage === "failed" && !!item.retrying)
  )
}

function connect(
  state: SshWindowState,
  event: Extract<SshWindowEvent, { type: "connect.requested" }>,
): SshWindowTransition {
  const id = event.config.id
  const current = state.attempts.get(id)

  const waiters = [
    ...(current && isActive(current) ? current.waiters : []),
    ...(event.onConnected ? [event.onConnected] : []),
  ]

  // Without the main side nothing can connect: the attempt fails at once, as one main rejects.
  if (!event.ipcActive)
    return {
      state: put(state, id, { status: "failed" }),
      effects: [...(current && isCalling(current) ? [abort(id)] : []), toast, ...notifyAll(waiters, false)],
    }

  // Another window answers the server's prompt; this one cannot join it.
  if (event.item?.authenticatingElsewhere)
    return { state, effects: event.onConnected ? [notify([event.onConnected], false)] : [] }

  // A second request joins the attempt in progress; a dialog that opens for it shows its prompts.
  if (current && isActive(current) && !event.replace && !(current.status === "waiting" && current.error))
    return {
      state: put(state, id, {
        ...current,
        dialog: event.dialog && current.dialog === "none" ? "owned" : current.dialog,
        waiters,
      }),
      effects: [],
    }
  const attempt = state.issued + 1

  return {
    state: put({ ...state, issued: attempt }, id, {
      status: "starting",
      attempt,
      dialog: event.dialog ? "owned" : current && isActive(current) ? current.dialog : "none",
      waiters,
    }),
    effects: [
      ...(current && isCalling(current) ? [abort(id)] : []),
      { type: "rpc.start", id, attempt, config: event.config, replace: !!event.replace },
    ],
  }
}

function synced(state: SshWindowState, ipcActive: boolean, items: readonly SshItem[]): SshWindowTransition {
  // Saved servers reconnect in the background once per window. Connected ones count as seen too, so a later
  // disconnect is respected.
  const unseen = items.filter((item) => item.saved && !state.restored.has(item.config.id))

  const settled = [...state.attempts].flatMap(([id, attempt]) => {
    if (attempt.status !== "waiting") return []

    const outcome = settle(
      attempt,
      items.find((item) => item.config.id === id),
    )

    return outcome === undefined ? [] : [{ id, waiters: attempt.waiters, ready: outcome }]
  })

  if (unseen.length === 0 && settled.length === 0) return unchanged(state)
  const attempts = new Map(state.attempts)
  settled.forEach((item) => attempts.delete(item.id))

  return {
    state: {
      ...state,
      attempts,
      restored: unseen.length ? new Set([...state.restored, ...unseen.map((item) => item.config.id)]) : state.restored,
    },
    effects: [
      ...(ipcActive
        ? unseen.flatMap((item): SshWindowEffect[] =>
            item.stage === "disconnected" ? [{ type: "rpc.restore", config: item.config }] : [],
          )
        : []),
      ...settled.flatMap((item) => notifyAll(item.waiters, item.ready)),
    ],
  }
}

/** Waits on main's state, or settles at once when it already shows the outcome. */
function wait(
  state: SshWindowState,
  id: string,
  attempt: Extract<SshAttemptState, { status: "waiting" }>,
  item: SshItem | undefined,
): SshWindowTransition {
  const outcome = settle(attempt, item)

  if (outcome === undefined) return { state: put(state, id, attempt), effects: [] }

  return { state: remove(state, id), effects: notifyAll(attempt.waiters, outcome) }
}

/** Whether main's state ends the attempt, and whether the server is ready then. */
function settle(attempt: Extract<SshAttemptState, { status: "waiting" }>, item: SshItem | undefined) {
  if (!item) return false

  if (item.stage === "ready") return true

  if (item.stage === "failed" || item.stage === "disconnected" || item.authenticatingElsewhere) return false

  // The prompt this window showed went away without the server connecting.
  if (attempt.dialog !== "none" && item.stage === "authentication" && !item.prompt) return false

  return undefined
}

function isActive(attempt: SshAttemptState): attempt is Active {
  return attempt.status !== "failed"
}

function isCalling(attempt: SshAttemptState) {
  return attempt.status === "starting" || attempt.status === "answering"
}

function put(state: SshWindowState, id: string, attempt: SshAttemptState): SshWindowState {
  return { ...state, attempts: new Map(state.attempts).set(id, attempt) }
}

function remove(state: SshWindowState, id: string): SshWindowState {
  const attempts = new Map(state.attempts)
  attempts.delete(id)

  return { ...state, attempts }
}

const toast: SshWindowEffect = { type: "toast.error" }

function abort(id: string): SshWindowEffect {
  return { type: "task.abort", id }
}

function notify(waiters: readonly Waiter[], ready: boolean): SshWindowEffect {
  return { type: "waiters.notify", waiters, ready }
}

function notifyAll(waiters: readonly Waiter[], ready: boolean): SshWindowEffect[] {
  return waiters.length ? [notify(waiters, ready)] : []
}

function unchanged(state: SshWindowState): SshWindowTransition {
  return { state, effects: [] }
}
