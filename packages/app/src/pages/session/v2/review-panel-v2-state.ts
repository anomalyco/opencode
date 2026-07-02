import {
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN,
  type SessionReviewExpandMode,
} from "@opencode-ai/session-ui/v2/session-review-v2"
import { createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export function createReviewPanelV2State() {
  const [store, setStore] = persisted(
    Persist.global("review-panel-v2"),
    createStore({
      sidebarOpened: true,
      sidebarWidth: SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
      expandMode: "collapse" as SessionReviewExpandMode,
    }),
  )
  // The filter is transient by design: a persisted filter would silently hide
  // files after a reload.
  const [filter, setFilter] = createSignal("")

  return {
    sidebarOpened: () => store.sidebarOpened,
    sidebarWidth: () => store.sidebarWidth,
    filter,
    setFilter,
    expandMode: () => store.expandMode,
    setExpandMode: (mode: SessionReviewExpandMode) => setStore("expandMode", mode),
    resizeSidebar: (width: number) =>
      setStore(
        "sidebarWidth",
        Math.min(SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX, Math.max(SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN, width)),
      ),
    toggleSidebar: () => setStore("sidebarOpened", (opened) => !opened),
  }
}

export type ReviewPanelV2State = ReturnType<typeof createReviewPanelV2State>
