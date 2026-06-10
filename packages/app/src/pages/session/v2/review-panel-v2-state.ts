import type { SessionReviewExpandMode } from "@opencode-ai/ui/v2/session-review-v2"
import { createStore } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"

export const REVIEW_PANEL_V2_SIDEBAR_WIDTH_DEFAULT = 240
export const REVIEW_PANEL_V2_SIDEBAR_WIDTH_MIN = 200
export const REVIEW_PANEL_V2_SIDEBAR_WIDTH_MAX = 480

export function createReviewPanelV2State() {
  const [store, setStore] = persisted(
    Persist.global("review-panel-v2"),
    createStore({
      sidebarOpened: true,
      sidebarWidth: REVIEW_PANEL_V2_SIDEBAR_WIDTH_DEFAULT,
      filter: "",
      filesFilter: "",
      expandMode: "collapse" as SessionReviewExpandMode,
    }),
  )

  return {
    sidebarOpened: () => store.sidebarOpened,
    sidebarWidth: () => store.sidebarWidth,
    filter: () => store.filter,
    filesFilter: () => store.filesFilter,
    expandMode: () => store.expandMode,
    setFilter: (value: string) => setStore("filter", value),
    setFilesFilter: (value: string) => setStore("filesFilter", value),
    setExpandMode: (mode: SessionReviewExpandMode) => setStore("expandMode", mode),
    resizeSidebar: (width: number) =>
      setStore(
        "sidebarWidth",
        Math.min(REVIEW_PANEL_V2_SIDEBAR_WIDTH_MAX, Math.max(REVIEW_PANEL_V2_SIDEBAR_WIDTH_MIN, width)),
      ),
    toggleSidebar: () => setStore("sidebarOpened", (opened) => !opened),
    openSidebar: () => setStore("sidebarOpened", true),
    closeSidebar: () => setStore("sidebarOpened", false),
  }
}

export type ReviewPanelV2State = ReturnType<typeof createReviewPanelV2State>
