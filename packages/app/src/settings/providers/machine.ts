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

export type ProviderDisconnectState = {
  /** Holds only rows that are not "connected"; a missing ID is a connected row. */
  readonly rows: Readonly<Record<string, Exclude<ProviderRowState, { status: "connected" }>>>
  readonly nextAttempt: number
}

export type ProviderDisconnectEvent =
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

export type ProviderDisconnectEffect =
  | { readonly type: "disconnect.run"; readonly attempt: number; readonly integrationID: string }
  | { readonly type: "toast.disconnected"; readonly providerName: string }
  | { readonly type: "toast.failed"; readonly providerName: string; readonly reason: DisconnectFailure }

export type ProviderDisconnectTransition = {
  readonly state: ProviderDisconnectState
  readonly effects: readonly ProviderDisconnectEffect[]
}

const CONNECTED: ProviderRowState = { status: "connected" }

export function createProviderDisconnectState(): ProviderDisconnectState {
  return { rows: {}, nextAttempt: 1 }
}

export function transitionProviderDisconnect(
  state: ProviderDisconnectState,
  event: ProviderDisconnectEvent,
): ProviderDisconnectTransition {
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

export function providerRow(state: ProviderDisconnectState, providerID: string): ProviderRowState {
  return state.rows[providerID] ?? CONNECTED
}

/** A row leaves the Connected list while its removal runs and after the server confirms it, and returns on failure. */
export function connectedProviders<T extends { readonly id: string }>(
  state: ProviderDisconnectState,
  available: readonly T[],
) {
  return available.filter((item) => providerRow(state, item.id).status === "connected")
}

function requested(
  state: ProviderDisconnectState,
  event: Extract<ProviderDisconnectEvent, { type: "disconnect.requested" }>,
): ProviderDisconnectTransition {
  if (event.providerIDs.some((id) => providerRow(state, id).status !== "connected")) return { state, effects: [] }
  const attempt = state.nextAttempt

  return {
    state: {
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

function settled(
  state: ProviderDisconnectState,
  attempt: number,
  failure: DisconnectFailure | undefined,
): ProviderDisconnectTransition {
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
function update(
  state: ProviderDisconnectState,
  next: (id: string, row: ProviderDisconnectState["rows"][string]) => ProviderRowState,
): ProviderDisconnectState {
  const entries = Object.entries(state.rows).map(([id, row]) => [id, row, next(id, row)] as const)

  if (entries.every(([, row, result]) => row === result)) return state

  return {
    ...state,
    rows: Object.fromEntries(
      entries.flatMap(([id, , row]) => (row.status === "connected" ? [] : [[id, row] as const])),
    ),
  }
}
