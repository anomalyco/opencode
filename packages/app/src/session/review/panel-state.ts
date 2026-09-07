import {
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX,
  SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN,
  type SessionReviewExpandMode,
} from "@opencode-ai/session-ui/v2/session-review-v2"
import { createSignal } from "solid-js"
import { Schema } from "effect"
import type { Platform } from "@/runtime/platform/platform"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"

const ReviewPanel = Persistence.struct({
  sidebarOpened: Schema.Boolean,
  sidebarWidth: Schema.Finite.check(
    Schema.isBetween({ minimum: SESSION_REVIEW_V2_SIDEBAR_WIDTH_MIN, maximum: SESSION_REVIEW_V2_SIDEBAR_WIDTH_MAX }),
  ),
  expandMode: Schema.Literals(["expand", "collapse"]),
})

export function createReviewPanelState(platform?: Platform) {
  const [store, setStore, , ready] = persisted(
    Persist.global("review-panel-v2"),
    ReviewPanel,
    { sidebarOpened: true, sidebarWidth: SESSION_REVIEW_V2_SIDEBAR_WIDTH_DEFAULT, expandMode: "collapse" },
    platform,
  )
  // The filter is transient by design: a persisted filter would silently hide
  // files after a reload.
  const [filter, setFilter] = createSignal("")

  return {
    sidebarOpened: () => store.sidebarOpened,
    sidebarWidth: () => store.sidebarWidth,
    sidebarTransition: ready,
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

export type ReviewPanelState = ReturnType<typeof createReviewPanelState>
