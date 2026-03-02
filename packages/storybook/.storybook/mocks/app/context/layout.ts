import { createSignal } from "solid-js"

const [all, setAll] = createSignal<string[]>([])
const [active, setActive] = createSignal<string | undefined>(undefined)
const [reviewOpen, setReviewOpen] = createSignal(false)

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
