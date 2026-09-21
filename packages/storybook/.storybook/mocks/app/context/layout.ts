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
const [terminalOpen, setTerminalOpen] = createSignal(false)
const [reviewWidth, setReviewWidth] = createSignal(600)
const [terminalHeight, setTerminalHeight] = createSignal(280)

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
    width: reviewWidth,
    resize: setReviewWidth,
  },
  terminal: {
    opened: terminalOpen,
    open: () => setTerminalOpen(true),
    close: () => setTerminalOpen(false),
    height: terminalHeight,
    resize: setTerminalHeight,
  },
  review: {
    mode: () => "git" as const,
    setMode() {},
    file: () => undefined,
    setFile() {},
    openPath() {},
  },
  setScroll() {},
}

export function useLayout() {
  return {
    route: () => ({ type: "home" as const }),
    tabs: () => tabs,
    view: () => view,
    fileTree: {
      opened: () => false,
      width: () => 200,
      tab: () => "all" as const,
      setTab() {},
    },
    review: {
      diffStyle: () => "unified" as const,
      setDiffStyle() {},
    },
    ready: () => true,
    handoff: {
      setTabs() {},
    },
    pendingMessage: {
      consume() {},
    },
  }
}
