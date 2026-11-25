import type { ClosedTab } from "./closed"
import type { SessionTab } from "./tabs"

export type ClosedTabOp =
  | { readonly kind: "update"; readonly update: (stack: ClosedTab[]) => ClosedTab[] }
  | { readonly kind: "reopen"; readonly target?: SessionTab; readonly options?: { readonly append?: boolean } }

export type RecentHydration =
  | { readonly status: "hydrating"; readonly written: false }
  | { readonly status: "hydrating"; readonly written: true; readonly key: string | undefined }
  | { readonly status: "ready" }

export type ClosedHydration =
  | { readonly status: "hydrating"; readonly queue: readonly ClosedTabOp[] }
  | { readonly status: "ready" }

/**
 * Writes to the window's recent tab and closed tab stores made before they load from storage. The recent key reads
 * back at once and lands once its store loads; closed tab operations queue in order and apply once theirs loads,
 * also when the load failed and the store runs from its initial value.
 */
export type TabsHydrationState =
  | { readonly status: "active"; readonly recent: RecentHydration; readonly closed: ClosedHydration }
  | { readonly status: "disposed" }

const READY = { status: "ready" } as const

export type TabsHydrationEvent =
  | { readonly type: "recent.set"; readonly key: string | undefined; readonly persistedKey: string | undefined }
  | { readonly type: "recent.hydrated"; readonly persistedKey: string | undefined }
  | { readonly type: "closed.op"; readonly op: ClosedTabOp }
  | { readonly type: "closed.hydrated" }
  | { readonly type: "disposed" }

export type TabsHydrationEffect =
  | { readonly type: "recent.commit"; readonly key: string | undefined }
  | { readonly type: "closed.apply"; readonly ops: readonly ClosedTabOp[] }

export type TabsHydrationTransition = {
  readonly state: TabsHydrationState
  readonly effects: readonly TabsHydrationEffect[]
}

/** Starts each store ready when it loaded synchronously, like local storage on the web. */
export const createTabsHydrationState = (ready: { recent: boolean; closed: boolean }): TabsHydrationState => ({
  status: "active",
  recent: ready.recent ? READY : { status: "hydrating", written: false },
  closed: ready.closed ? READY : { status: "hydrating", queue: [] },
})

const NO_EFFECTS: readonly TabsHydrationEffect[] = []

export function transitionTabsHydration(state: TabsHydrationState, event: TabsHydrationEvent): TabsHydrationTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  switch (event.type) {
    case "disposed":
      return { state: { status: "disposed" }, effects: NO_EFFECTS }
    case "recent.set": {
      if (state.recent.status === "ready")
        return {
          state,
          effects: event.key === event.persistedKey ? NO_EFFECTS : [{ type: "recent.commit", key: event.key }],
        }

      if (state.recent.written && state.recent.key === event.key) return { state, effects: NO_EFFECTS }

      return {
        state: { ...state, recent: { status: "hydrating", written: true, key: event.key } },
        effects: NO_EFFECTS,
      }
    }

    case "recent.hydrated": {
      const recent = state.recent

      if (recent.status === "ready") return { state, effects: NO_EFFECTS }

      return {
        state: { ...state, recent: READY },
        effects:
          recent.written && recent.key !== event.persistedKey
            ? [{ type: "recent.commit", key: recent.key }]
            : NO_EFFECTS,
      }
    }

    case "closed.op": {
      if (state.closed.status === "ready") return { state, effects: [{ type: "closed.apply", ops: [event.op] }] }

      return {
        state: { ...state, closed: { status: "hydrating", queue: [...state.closed.queue, event.op] } },
        effects: NO_EFFECTS,
      }
    }

    case "closed.hydrated": {
      const closed = state.closed

      if (closed.status === "ready") return { state, effects: NO_EFFECTS }

      return {
        state: { ...state, closed: READY },
        effects: closed.queue.length ? [{ type: "closed.apply", ops: closed.queue }] : NO_EFFECTS,
      }
    }
  }
}

/** The recent tab key: a write made before the store loads reads back at once, even one that clears it. */
export function selectRecentTabKey(state: TabsHydrationState, persistedKey: string | undefined) {
  if (state.status === "active" && state.recent.status === "hydrating" && state.recent.written) return state.recent.key

  return persistedKey
}
