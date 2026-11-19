export type RestoreStep<T> =
  | { readonly kind: "adopt"; readonly id: string; readonly entry: T }
  | { readonly kind: "create"; readonly id: string }

/**
 * The first window, created and shown the moment Electron is ready, before the layers load. Restoring adopts it when
 * its id is still persisted. Closing it before then is a quit, and nothing restores another window after that.
 */
export type EarlyWindowState<T> =
  | { readonly status: "none" }
  | { readonly status: "pending"; readonly id: string; readonly entry: T }
  /** Its external links now go through the logged handler the layers provide. */
  | {
      readonly status: "adopted"
      readonly id: string
      readonly entry: T
      readonly openExternal: (url: string) => void
    }
  | { readonly status: "closed" }

export type EarlyWindowEvent<T> =
  | { readonly type: "early.created"; readonly id: string; readonly entry: T }
  | { readonly type: "early.closed"; readonly entry: T }
  | { readonly type: "external.opened"; readonly entry: T; readonly url: string }
  | {
      readonly type: "restore.requested"
      /** The persisted window ids, already validated. */
      readonly ids: readonly string[]
      /** The id of the window to create when none is persisted and no early window waits. */
      readonly fallbackId: string
      /** Electron already destroyed the pending window. */
      readonly destroyed: boolean
      readonly openExternal: (url: string) => void
    }

export type EarlyWindowCommand<T> =
  | { readonly type: "open-external-early"; readonly url: string }
  | { readonly type: "open-external-adopted"; readonly url: string; readonly openExternal: (url: string) => void }
  | { readonly type: "destroy-early"; readonly entry: T }
  | { readonly type: "restore-windows"; readonly plan: readonly RestoreStep<T>[] }
  | { readonly type: "quit" }

export type EarlyWindowTransition<T> = {
  readonly state: EarlyWindowState<T>
  readonly commands: readonly EarlyWindowCommand<T>[]
}

const NONE = Object.freeze({ status: "none" as const })

const CLOSED = Object.freeze({ status: "closed" as const })

export function initialEarlyWindowState<T>(): EarlyWindowState<T> {
  return NONE
}

export function transitionEarlyWindow<T>(
  state: EarlyWindowState<T>,
  event: EarlyWindowEvent<T>,
): EarlyWindowTransition<T> {
  if (event.type === "early.created")
    return state.status === "none"
      ? { state: { status: "pending", id: event.id, entry: event.entry }, commands: [] }
      : unchanged(state)

  if (event.type === "restore.requested") return restore(state, event)

  if (state.status !== "pending" && state.status !== "adopted") return unchanged(state)

  if (event.entry !== state.entry) return unchanged(state)

  if (event.type === "external.opened")
    return unchanged(
      state,
      state.status === "pending"
        ? [{ type: "open-external-early", url: event.url }]
        : [{ type: "open-external-adopted", url: event.url, openExternal: state.openExternal }],
    )

  // Closing the only window before the rest of the app has adopted it is a quit.
  if (state.status === "pending") return { state: CLOSED, commands: [{ type: "quit" }] }

  return { state: NONE, commands: [] }
}

function restore<T>(
  state: EarlyWindowState<T>,
  event: Extract<EarlyWindowEvent<T>, { type: "restore.requested" }>,
): EarlyWindowTransition<T> {
  // The user closed the first window while the layers loaded: the app is quitting and opens no other window.
  if (state.status === "closed") return unchanged(state)

  if (state.status === "pending" && event.destroyed) return { state: CLOSED, commands: [{ type: "quit" }] }

  if (state.status !== "pending") {
    const ids = event.ids.length ? event.ids : [event.fallbackId]

    return unchanged(state, [{ type: "restore-windows", plan: ids.map((id) => ({ kind: "create", id })) }])
  }

  const ids = event.ids.length ? event.ids : [state.id]

  const plan = ids.map(
    (id): RestoreStep<T> => (id === state.id ? { kind: "adopt", id, entry: state.entry } : { kind: "create", id }),
  )

  // The persisted list changed after the early window chose its id.
  if (!ids.includes(state.id))
    return {
      state: NONE,
      commands: [
        { type: "destroy-early", entry: state.entry },
        { type: "restore-windows", plan },
      ],
    }

  return {
    state: { status: "adopted", id: state.id, entry: state.entry, openExternal: event.openExternal },
    commands: [{ type: "restore-windows", plan }],
  }
}

function unchanged<T>(
  state: EarlyWindowState<T>,
  commands: readonly EarlyWindowCommand<T>[] = [],
): EarlyWindowTransition<T> {
  return { state, commands }
}

/** The first window closed before the layers adopted it, so the app is quitting. */
export const isEarlyWindowClosed = <T>(state: EarlyWindowState<T>) => state.status === "closed"
