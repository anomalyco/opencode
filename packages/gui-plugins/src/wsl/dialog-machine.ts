/** Ceiling for the dialog's quick calls (`refreshDistros`, `addServer`), above main's 20 s `wsl.exe` timeout. */
export const WSL_ACTION_TIMEOUT_MS = 60_000

/**
 * Ceiling for the install calls (`installWsl`, `installDistro`, `installOpencode`), in case the bridge hangs. Main
 * stops an install after 15 minutes, and a distro install then lists and probes for up to another minute, so this
 * waits a minute beyond that before the dialog gives up on the answer.
 */
export const WSL_INSTALL_TIMEOUT_MS = 17 * 60_000

/** A call to main the dialog's main view starts. */
export type WslMainOp =
  | { readonly kind: "install-wsl" }
  | { readonly kind: "refresh-distros" }
  | { readonly kind: "install-opencode"; readonly distro: string }
  | { readonly kind: "add-server"; readonly distro: string }

export type WslDialogAction = WslMainOp | { readonly kind: "install-distro"; readonly distro: string }

/**
 * The window's side of the "Add WSL server" dialog: which view shows, and the call to main it waits for. A running
 * variant claims the click before the call leaves, so the dialog is busy before main's state says so. `completed`
 * keeps the dialog busy while it closes after a server was added. `issued` is the last attempt handed out.
 */
export type WslDialogState =
  | { readonly status: "main"; readonly issued: number; readonly selectedDistro: string | null }
  | {
      readonly status: "main-running"
      readonly issued: number
      readonly selectedDistro: string | null
      readonly attempt: number
      readonly op: WslMainOp
    }
  | {
      readonly status: "catalog"
      readonly issued: number
      readonly selectedDistro: string | null
      readonly catalogSearch: string
      readonly catalogTarget: string | null
    }
  | {
      readonly status: "catalog-installing"
      readonly issued: number
      readonly selectedDistro: string | null
      readonly catalogSearch: string
      readonly catalogTarget: string | null
      readonly attempt: number
      readonly distro: string
    }
  | { readonly status: "completed"; readonly selectedDistro: string | null }
  | { readonly status: "disposed" }

/** User actions carry what the dialog shows when they happen; `busy` also counts jobs main runs and probes. */
export type WslDialogEvent =
  | { readonly type: "distro.selected"; readonly distro: string }
  | { readonly type: "catalog.opened"; readonly defaultTarget: string | null; readonly busy: boolean }
  | { readonly type: "catalog.closed"; readonly busy: boolean }
  | { readonly type: "catalog.search.changed"; readonly value: string }
  | { readonly type: "catalog.target.changed"; readonly distro: string }
  | { readonly type: "catalog.install.requested"; readonly distro: string | null; readonly busy: boolean }
  | { readonly type: "wsl.install.requested"; readonly busy: boolean }
  | { readonly type: "distros.refresh.requested"; readonly busy: boolean }
  | {
      readonly type: "primary.requested"
      readonly distro: string | null
      readonly action: "install-opencode" | "add" | null
      readonly disabled: boolean
    }
  | { readonly type: "action.succeeded"; readonly attempt: number }
  /** The call rejected, or timed out without a `cause`. */
  | { readonly type: "action.failed"; readonly attempt: number; readonly cause?: unknown }
  /** WSL's main side went away or came back. */
  | { readonly type: "availability.changed"; readonly available: boolean }
  | { readonly type: "disposed" }

export type WslDialogEffect =
  | {
      readonly type: "action.run"
      readonly attempt: number
      readonly action: WslDialogAction
      readonly timeoutMs: number
    }
  /** Ends an attempt's call and timer. */
  | { readonly type: "action.abort"; readonly attempt: number }
  /** Probes that failed may run again: the user asked to check again or left the catalog. */
  | { readonly type: "probes.reset" }
  | { readonly type: "dialog.close" }
  | { readonly type: "toast.error"; readonly cause?: unknown }

export type WslDialogTransition = {
  readonly state: WslDialogState
  readonly effects: readonly WslDialogEffect[]
}

export function createWslDialogState(): WslDialogState {
  return { status: "main", issued: 0, selectedDistro: null }
}

export function transitionWslDialog(state: WslDialogState, event: WslDialogEvent): WslDialogTransition {
  if (state.status === "disposed") return unchanged(state)

  if (event.type === "disposed")
    return {
      state: { status: "disposed" },
      effects:
        state.status === "main-running" || state.status === "catalog-installing"
          ? [{ type: "action.abort", attempt: state.attempt }]
          : [],
    }

  if (state.status === "main") return transitionMain(state, event)

  if (state.status === "catalog") return transitionCatalog(state, event)

  if (state.status === "completed") return unchanged(state)

  return transitionRunning(state, event)
}

function transitionMain(
  state: Extract<WslDialogState, { status: "main" }>,
  event: WslDialogEvent,
): WslDialogTransition {
  if (event.type === "distro.selected") {
    if (state.selectedDistro === event.distro) return unchanged(state)

    return { state: { ...state, selectedDistro: event.distro }, effects: [] }
  }

  if (event.type === "catalog.opened") {
    if (event.busy) return unchanged(state)

    return {
      state: {
        status: "catalog",
        issued: state.issued,
        selectedDistro: state.selectedDistro,
        catalogSearch: "",
        catalogTarget: event.defaultTarget,
      },
      effects: [],
    }
  }

  if (event.type === "wsl.install.requested") {
    if (event.busy) return unchanged(state)

    return run(state, { kind: "install-wsl" }, WSL_INSTALL_TIMEOUT_MS, [])
  }

  if (event.type === "distros.refresh.requested") {
    if (event.busy) return unchanged(state)

    return run(state, { kind: "refresh-distros" }, WSL_ACTION_TIMEOUT_MS, [{ type: "probes.reset" }])
  }

  if (event.type === "primary.requested") {
    if (event.disabled || !event.distro || !event.action) return unchanged(state)

    if (event.action === "install-opencode")
      return run(state, { kind: "install-opencode", distro: event.distro }, WSL_INSTALL_TIMEOUT_MS, [])

    return run(state, { kind: "add-server", distro: event.distro }, WSL_ACTION_TIMEOUT_MS, [])
  }

  return unchanged(state)
}

function transitionCatalog(
  state: Extract<WslDialogState, { status: "catalog" }>,
  event: WslDialogEvent,
): WslDialogTransition {
  if (event.type === "catalog.closed") {
    if (event.busy) return unchanged(state)

    return {
      state: { status: "main", issued: state.issued, selectedDistro: state.selectedDistro },
      effects: [{ type: "probes.reset" }],
    }
  }

  if (event.type === "catalog.search.changed") {
    if (state.catalogSearch === event.value) return unchanged(state)

    return { state: { ...state, catalogSearch: event.value }, effects: [] }
  }

  if (event.type === "catalog.target.changed") {
    if (state.catalogTarget === event.distro) return unchanged(state)

    return { state: { ...state, catalogTarget: event.distro }, effects: [] }
  }

  if (event.type === "catalog.install.requested") {
    if (event.busy || !event.distro) return unchanged(state)

    const attempt = state.issued + 1

    return {
      state: {
        status: "catalog-installing",
        issued: attempt,
        selectedDistro: state.selectedDistro,
        catalogSearch: state.catalogSearch,
        catalogTarget: event.distro,
        attempt,
        distro: event.distro,
      },
      effects: [
        { type: "probes.reset" },
        {
          type: "action.run",
          attempt,
          action: { kind: "install-distro", distro: event.distro },
          timeoutMs: WSL_INSTALL_TIMEOUT_MS,
        },
      ],
    }
  }

  return unchanged(state)
}

// A running call ends in its own view: an installed distro returns to the list, a failed install stays in the catalog.
function transitionRunning(
  state: Extract<WslDialogState, { status: "main-running" | "catalog-installing" }>,
  event: WslDialogEvent,
): WslDialogTransition {
  const settled =
    state.status === "main-running"
      ? { status: "main" as const, issued: state.issued, selectedDistro: state.selectedDistro }
      : {
          status: "catalog" as const,
          issued: state.issued,
          selectedDistro: state.selectedDistro,
          catalogSearch: state.catalogSearch,
          catalogTarget: state.catalogTarget,
        }

  // Main going away answers the call itself: the dialog shows WSL as unavailable, without a toast.
  if (event.type === "availability.changed") {
    if (event.available) return unchanged(state)

    return { state: settled, effects: [{ type: "action.abort", attempt: state.attempt }] }
  }

  if (event.type !== "action.succeeded" && event.type !== "action.failed") return unchanged(state)

  if (event.attempt !== state.attempt) return unchanged(state)

  const abort: WslDialogEffect = { type: "action.abort", attempt: event.attempt }

  if (event.type === "action.failed") return { state: settled, effects: [abort, { type: "toast.error", cause: event.cause }] }

  if (state.status === "catalog-installing")
    return { state: { status: "main", issued: state.issued, selectedDistro: state.selectedDistro }, effects: [abort] }

  if (state.op.kind === "add-server")
    return {
      state: { status: "completed", selectedDistro: state.selectedDistro },
      effects: [abort, { type: "dialog.close" }],
    }

  return { state: settled, effects: [abort] }
}

function run(
  state: Extract<WslDialogState, { status: "main" }>,
  op: WslMainOp,
  timeoutMs: number,
  before: readonly WslDialogEffect[],
): WslDialogTransition {
  const attempt = state.issued + 1

  return {
    state: { status: "main-running", issued: attempt, selectedDistro: state.selectedDistro, attempt, op },
    effects: [...before, { type: "action.run", attempt, action: op, timeoutMs }],
  }
}

function unchanged(state: WslDialogState): WslDialogTransition {
  return { state, effects: [] }
}

/** Which view the dialog shows. */
export function selectWslDialogView(state: WslDialogState): "main" | "catalog" {
  return state.status === "catalog" || state.status === "catalog-installing" ? "catalog" : "main"
}

/** The distro the user picked, before the view model falls back to a default one. */
export function selectWslDialogSelectedDistro(state: WslDialogState) {
  return state.status === "disposed" ? null : state.selectedDistro
}

export function selectWslDialogCatalogSearch(state: WslDialogState) {
  return state.status === "catalog" || state.status === "catalog-installing" ? state.catalogSearch : ""
}

export function selectWslDialogCatalogTarget(state: WslDialogState) {
  return state.status === "catalog" || state.status === "catalog-installing" ? state.catalogTarget : null
}

/** The dialog waits for a call it started, or closes after one; its controls stay disabled meanwhile. */
export function selectWslDialogBusy(state: WslDialogState) {
  return state.status === "main-running" || state.status === "catalog-installing" || state.status === "completed"
}

/** A server is being added: Cancel is disabled and Add server spins. */
export function selectWslDialogAdding(state: WslDialogState) {
  return (state.status === "main-running" && state.op.kind === "add-server") || state.status === "completed"
}

export function selectWslDialogInstallingCatalog(state: WslDialogState) {
  return state.status === "catalog-installing"
}

export function selectWslDialogInstallingOpencode(state: WslDialogState, distro: string | null) {
  return (
    !!distro && state.status === "main-running" && state.op.kind === "install-opencode" && state.op.distro === distro
  )
}
