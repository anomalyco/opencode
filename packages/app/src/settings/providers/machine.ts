import type { ProviderAccount } from "./accounts"

export type DisconnectFailure =
  | { readonly kind: "no-credentials" }
  | { readonly kind: "request"; readonly error: unknown }

export type ProviderRowState =
  | { readonly status: "connected" }
  | {
      readonly status: "removing"
      readonly attempt: number
      readonly integrationID: string
      readonly providerName: string
      /** Whether the server catalog still lists the provider, so a confirmed removal knows whether to keep hiding it. */
      readonly inCatalog: boolean
    }
  // The server confirmed the removal but its catalog still lists the provider.
  | { readonly status: "removed"; readonly integrationID: string }

/** Holds only rows that are not "connected"; a missing ID is a connected row. */
export type ProviderRows = Readonly<Record<string, Exclude<ProviderRowState, { status: "connected" }>>>

/** The connect dialog is open, or closed and refreshing the catalog it may have changed. */
export type ProviderDialogHold = {
  readonly phase: "open" | "refreshing"
  readonly attempt: number
}

/** An account switch or removal that waits for the server and, for the Console, for the new workspace catalog. */
export type ProviderAccountBusy = {
  readonly phase: "activating" | "removing"
  readonly attempt: number
  readonly credentialID: string
}

type ProvidersBase = {
  readonly rows: ProviderRows
  readonly nextAttempt: number
}

/**
 * Settings › Providers.
 * - `live`: the list follows the catalog; an inline account rename may be open.
 * - `holding`: the connect dialog or an account action is running, so the Connected list stays on `held`, the list
 *   as it was when the first of them started. It goes live again only when both have finished.
 * An account action closes any rename and disables every account menu until it settles.
 */
export type SettingsProvidersState<T = unknown> =
  | (ProvidersBase & { readonly status: "live"; readonly renaming?: string })
  | (ProvidersBase & {
      readonly status: "holding"
      readonly held: readonly T[]
      readonly dialog: ProviderDialogHold
      readonly account?: undefined
      readonly renaming?: string
    })
  | (ProvidersBase & {
      readonly status: "holding"
      readonly held: readonly T[]
      readonly dialog?: ProviderDialogHold
      readonly account: ProviderAccountBusy
      readonly renaming?: undefined
    })

export type SettingsProvidersEvent<T = unknown> =
  /** `catalog` is the live Connected list, which the list holds if nothing holds it yet. */
  | { readonly type: "dialog.opened"; readonly provider?: string; readonly catalog: readonly T[] }
  | { readonly type: "dialog.closed"; readonly attempt: number }
  | { readonly type: "dialog.refresh.settled"; readonly attempt: number }
  | { readonly type: "account.rename.started"; readonly credentialID: string }
  | { readonly type: "account.rename.closed" }
  | {
      readonly type: "account.activate.requested"
      readonly integrationID: string
      readonly providerName: string
      readonly account: ProviderAccount
      readonly activeCredentialID: string | undefined
      readonly catalog: readonly T[]
    }
  | {
      readonly type: "account.remove.requested"
      readonly integrationID: string
      readonly providerName: string
      readonly account: ProviderAccount
      readonly final: boolean
      readonly catalog: readonly T[]
    }
  | { readonly type: "account.settled"; readonly attempt: number }
  | {
      readonly type: "disconnect.requested"
      /** The clicked provider, plus its Console workspace providers when it is the Console root. */
      readonly providerIDs: readonly string[]
      readonly integrationID: string
      readonly providerName: string
    }
  | { readonly type: "disconnect.succeeded"; readonly attempt: number }
  | { readonly type: "disconnect.failed"; readonly attempt: number; readonly reason: DisconnectFailure }
  | { readonly type: "provider.reconnected"; readonly providerID: string }
  | { readonly type: "catalog.synced"; readonly providerIDs: readonly string[] }

export type SettingsProvidersEffect =
  | { readonly type: "dialog.open"; readonly attempt: number; readonly provider?: string }
  | { readonly type: "catalog.refresh"; readonly attempt: number }
  | {
      readonly type: "account.activate.run"
      readonly attempt: number
      readonly integrationID: string
      readonly providerName: string
      readonly account: ProviderAccount
    }
  | {
      readonly type: "account.remove.run"
      readonly attempt: number
      readonly integrationID: string
      readonly providerName: string
      readonly account: ProviderAccount
      readonly final: boolean
    }
  | { readonly type: "disconnect.run"; readonly attempt: number; readonly integrationID: string }
  | { readonly type: "toast.disconnected"; readonly providerName: string }
  | { readonly type: "toast.failed"; readonly providerName: string; readonly reason: DisconnectFailure }

export type SettingsProvidersTransition<T = unknown> = {
  readonly state: SettingsProvidersState<T>
  readonly effects: readonly SettingsProvidersEffect[]
}

const CONNECTED: ProviderRowState = { status: "connected" }

export function createSettingsProvidersState<T>(): SettingsProvidersState<T> {
  return { status: "live", rows: {}, nextAttempt: 1 }
}

export function transitionSettingsProviders<T>(
  state: SettingsProvidersState<T>,
  event: SettingsProvidersEvent<T>,
): SettingsProvidersTransition<T> {
  if (event.type === "dialog.opened") {
    const attempt = state.nextAttempt

    return {
      state: hold(
        { ...state, nextAttempt: attempt + 1 },
        state.status === "holding" ? state.held : event.catalog,
        { phase: "open", attempt },
        state.account,
        state.renaming,
      ),
      effects: [{ type: "dialog.open", attempt, provider: event.provider }],
    }
  }

  if (event.type === "dialog.closed") {
    if (state.status !== "holding" || state.dialog?.phase !== "open" || state.dialog.attempt !== event.attempt)
      return { state, effects: [] }

    return {
      state: hold(state, state.held, { phase: "refreshing", attempt: event.attempt }, state.account, state.renaming),
      effects: [{ type: "catalog.refresh", attempt: event.attempt }],
    }
  }

  if (event.type === "dialog.refresh.settled") {
    if (state.status !== "holding" || state.dialog?.phase !== "refreshing" || state.dialog.attempt !== event.attempt)
      return { state, effects: [] }

    return { state: hold(state, state.held, undefined, state.account, state.renaming), effects: [] }
  }

  if (event.type === "account.rename.started") {
    if (state.account || state.renaming === event.credentialID) return { state, effects: [] }

    return { state: { ...state, renaming: event.credentialID }, effects: [] }
  }

  if (event.type === "account.rename.closed") {
    if (state.account || state.renaming === undefined) return { state, effects: [] }

    return { state: { ...state, renaming: undefined }, effects: [] }
  }

  if (event.type === "account.activate.requested" || event.type === "account.remove.requested") {
    if (state.account) return { state, effects: [] }

    if (event.type === "account.activate.requested" && event.account.id === event.activeCredentialID)
      return { state, effects: [] }
    const attempt = state.nextAttempt
    const phase = event.type === "account.activate.requested" ? "activating" : "removing"

    return {
      state: hold(
        { ...state, nextAttempt: attempt + 1 },
        state.status === "holding" ? state.held : event.catalog,
        state.status === "holding" ? state.dialog : undefined,
        { phase, attempt, credentialID: event.account.id },
        undefined,
      ),
      effects: [
        event.type === "account.activate.requested"
          ? {
              type: "account.activate.run",
              attempt,
              integrationID: event.integrationID,
              providerName: event.providerName,
              account: event.account,
            }
          : {
              type: "account.remove.run",
              attempt,
              integrationID: event.integrationID,
              providerName: event.providerName,
              account: event.account,
              final: event.final,
            },
      ],
    }
  }

  if (event.type === "account.settled") {
    if (state.account?.attempt !== event.attempt || state.status !== "holding") return { state, effects: [] }

    return { state: hold(state, state.held, state.dialog, undefined, undefined), effects: [] }
  }

  if (event.type === "disconnect.requested") return requested(state, event)

  if (event.type === "disconnect.succeeded") return settled(state, event.attempt, undefined)

  if (event.type === "disconnect.failed") return settled(state, event.attempt, event.reason)

  if (event.type === "provider.reconnected")
    return {
      state: update(state, (id, row) =>
        id === event.providerID || row.integrationID === event.providerID ? CONNECTED : row,
      ),
      effects: [],
    }

  return {
    state: update(state, (id, row) => {
      const inCatalog = event.providerIDs.includes(id)

      if (row.status === "removed") return inCatalog ? row : CONNECTED

      return row.inCatalog === inCatalog ? row : { ...row, inCatalog }
    }),
    effects: [],
  }
}

/** The Connected list to show: the held one while the dialog or an account action runs, otherwise the live one. */
export function availableProviders<T>(state: SettingsProvidersState<T>, live: readonly T[]) {
  return state.status === "holding" ? state.held : live
}

export function providerAccountView(state: SettingsProvidersState) {
  return { busy: state.account !== undefined, renaming: state.renaming }
}

export function providerRow(state: ProvidersBase, providerID: string): ProviderRowState {
  return state.rows[providerID] ?? CONNECTED
}

/** A row leaves the Connected list while its removal runs and after the server confirms it, and returns on failure. */
export function connectedProviders<T extends { readonly id: string }>(state: ProvidersBase, available: readonly T[]) {
  return available.filter((item) => providerRow(state, item.id).status === "connected")
}

function hold<T>(
  base: ProvidersBase,
  held: readonly T[],
  dialog: ProviderDialogHold | undefined,
  account: ProviderAccountBusy | undefined,
  renaming: string | undefined,
): SettingsProvidersState<T> {
  const rows = base.rows
  const nextAttempt = base.nextAttempt

  if (account) return { status: "holding", rows, nextAttempt, held, dialog, account }

  if (dialog) return { status: "holding", rows, nextAttempt, held, dialog, renaming }

  return { status: "live", rows, nextAttempt, renaming }
}

function requested<T>(
  state: SettingsProvidersState<T>,
  event: Extract<SettingsProvidersEvent<T>, { type: "disconnect.requested" }>,
): SettingsProvidersTransition<T> {
  if (event.providerIDs.some((id) => providerRow(state, id).status !== "connected")) return { state, effects: [] }
  const attempt = state.nextAttempt

  return {
    state: {
      ...state,
      rows: {
        ...state.rows,
        ...Object.fromEntries(
          event.providerIDs.map((id) => [
            id,
            {
              status: "removing",
              attempt,
              integrationID: event.integrationID,
              providerName: event.providerName,
              inCatalog: true,
            } as const,
          ]),
        ),
      },
      nextAttempt: attempt + 1,
    },
    effects: [{ type: "disconnect.run", attempt, integrationID: event.integrationID }],
  }
}

function settled<T>(
  state: SettingsProvidersState<T>,
  attempt: number,
  failure: DisconnectFailure | undefined,
): SettingsProvidersTransition<T> {
  const current = Object.values(state.rows).find((row) => row.status === "removing" && row.attempt === attempt)

  if (current?.status !== "removing") return { state, effects: [] }

  return {
    state: update(state, (_, row) => {
      if (row.status !== "removing" || row.attempt !== attempt) return row

      if (failure || !row.inCatalog) return CONNECTED

      return { status: "removed", integrationID: row.integrationID }
    }),
    effects: [
      failure
        ? { type: "toast.failed", providerName: current.providerName, reason: failure }
        : { type: "toast.disconnected", providerName: current.providerName },
    ],
  }
}

// Returns the same state object when no row changes, so the signal holding it does not notify.
function update<T>(
  state: SettingsProvidersState<T>,
  next: (id: string, row: ProviderRows[string]) => ProviderRowState,
): SettingsProvidersState<T> {
  const entries = Object.entries(state.rows).map(([id, row]) => [id, row, next(id, row)] as const)

  if (entries.every(([, row, result]) => row === result)) return state

  return {
    ...state,
    rows: Object.fromEntries(
      entries.flatMap(([id, , row]) => (row.status === "connected" ? [] : [[id, row] as const])),
    ),
  }
}
