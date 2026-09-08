import {
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN,
  type SessionReviewExpandMode,
} from "@opencode/session-ui/v2/session-review-v2"
import { createStore } from "solid-js/store"
import type { Storage } from "@opencode/plugin/desktop/context"

export function createReviewPanelState(storage?: Storage) {
  const initial = {
    sidebarOpened: true,
    sidebarWidth: SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
    expandMode: "collapse" as SessionReviewExpandMode,
  }
  const [fallback, setFallback] = createStore(initial)
  const [store, update] = storage?.store("panel", { initial }) ?? [
    fallback,
    (change: (draft: typeof initial) => void) => {
      const next = { ...fallback }
      change(next)
      setFallback(next)
    },
  ]
  const [transient, setTransient] = createStore({ filter: "" })
  return {
    sidebarOpened: () => store.sidebarOpened,
    sidebarWidth: () => store.sidebarWidth,
    sidebarTransition: () => true,
    filter: () => transient.filter,
    setFilter: (value: string) => setTransient("filter", value),
    expandMode: () => store.expandMode,
    setExpandMode: (value: SessionReviewExpandMode) =>
      update((draft) => {
        draft.expandMode = value
      }),
    resizeSidebar: (width: number) =>
      update((draft) => {
        draft.sidebarWidth = Math.min(
          SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
          Math.max(SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN, width),
        )
      }),
    toggleSidebar: () =>
      update((draft) => {
        draft.sidebarOpened = !draft.sidebarOpened
      }),
  }
}
export type ReviewPanelState = ReturnType<typeof createReviewPanelState>
