import { createSignal } from "solid-js"
import type { Project } from "@/runtime/server/types"

export type LocalProject = Partial<Project> & { worktree: string; expanded: boolean }

export function getProjectAvatarVariant(key?: string) {
  if (key === "mint") return "cyan" as const
  if (key === "lime") return "green" as const
  if (
    key === "orange" ||
    key === "yellow" ||
    key === "cyan" ||
    key === "green" ||
    key === "red" ||
    key === "pink" ||
    key === "blue" ||
    key === "purple" ||
    key === "gray"
  )
    return key
  return "gray" as const
}

const [all, setAll] = createSignal<string[]>([])
const [active, setActive] = createSignal<string | undefined>(undefined)
const [reviewOpen, setReviewOpen] = createSignal(false)

export function useCurrentRoute() {
  return () => ({ type: "home" as const })
}

const tabs = {
  all,
  active,
  open(tab: string) {
    setAll((current) => (current.includes(tab) ? current : [...current, tab]))
  },
  setActive(tab: string) {
    if (!all().includes(tab)) {
      tabs.open(tab)
    }
    setActive(tab)
  },
}

const view = {
  reviewPanel: {
    opened: reviewOpen,
    open() {
      setReviewOpen(true)
    },
  },
}

export function useLayout() {
  return {
    tabs: () => tabs,
    view: () => view,
    fileTree: {
      setTab() {},
    },
    handoff: {
      setTabs() {},
    },
  }
}
