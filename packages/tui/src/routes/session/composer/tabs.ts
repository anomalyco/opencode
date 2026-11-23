import { createEffect, createMemo, on, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { Plugin } from "@opencode/plugin/tui"
import type { ComposerTab } from "./context"
import { ownedJobs } from "../../../util/session"

const order = ["subagents", "shell", "scripts", "terminals"]

const rank = (id: string) => {
  const index = order.indexOf(id)
  return index < 0 ? order.length : index
}

// What a session has running, for the picker tabs and the prompt footer.
export function busyCounts(input: {
  data: Plugin.Context["data"]
  sessionID: string
  location: Parameters<Plugin.Context["data"]["shell"]["list"]>[0]
}) {
  const jobs = input.data.job.list(input.sessionID)
  return {
    scripts: jobs.filter((job) => job.kind === "codemode" && job.sessionID === input.sessionID).length,
    subagents: input.data.session
      .family(input.sessionID)
      .filter(
        (id) =>
          id !== input.sessionID &&
          (input.data.session.status(id) === "running" ||
            ownedJobs(jobs, id, (sessionID) => input.data.session.get(sessionID)?.parentID).length > 0),
      ).length,
    shells: input.data.shell.list(input.location).filter((shell) => shell.metadata.sessionID === input.sessionID)
      .length,
  }
}

// The tab the picker opens on when nothing asks for one: the first that has something running, else Subagents.
export function busyTab(input: { scripts: number; subagents: number; shells: number }) {
  if (input.scripts) return "scripts"
  if (input.subagents) return "subagents"
  if (input.shells) return "shell"
  return "subagents"
}

// The picker's tabs in a fixed order, and which one is active. Tabs that come and go while it is open, like Scripts,
// leave the active tab alone unless they remove it.
export function createComposerTabs(input: { open: () => boolean; defaultTab: () => string | undefined }) {
  const [store, setStore] = createStore({
    tabs: {} as Record<string, ComposerTab>,
    active: "",
    // Set once the user picks a tab, so a requested tab that registers late no longer takes over.
    chosen: false,
  })

  const list = createMemo(() => Object.values(store.tabs).toSorted((a, b) => rank(a.id) - rank(b.id)))

  const pick = (tabs: ComposerTab[]) => {
    const defaultTab = input.defaultTab()
    const match = defaultTab && tabs.find((tab) => tab.id === defaultTab)
    setStore("active", match ? match.id : tabs[0].id)
  }

  createEffect(
    on(
      () => [input.open(), input.defaultTab()] as const,
      ([open]) => {
        setStore("chosen", false)
        const tabs = untrack(list)
        if (open && tabs.length > 0) pick(tabs)
      },
    ),
  )

  createEffect(() => {
    const tabs = list()
    if (!input.open() || tabs.length === 0) return
    const requested = input.defaultTab()
    const late = !store.chosen && requested && requested !== store.active && tabs.some((tab) => tab.id === requested)
    if (late || !tabs.some((tab) => tab.id === store.active)) pick(tabs)
  })

  return {
    list,
    active: () => store.active,
    setActive: (id: string) => setStore({ active: id, chosen: true }),
    register(tab: ComposerTab) {
      setStore("tabs", tab.id, tab)
      if (!store.active) setStore("active", tab.id)
      return () => setStore("tabs", tab.id, undefined!)
    },
  }
}
