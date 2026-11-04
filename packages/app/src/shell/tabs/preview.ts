import { createStore } from "solid-js/store"
import type { SessionTab, Tab } from "./tabs"

export function createSessionPreview(options: {
  tabs: () => readonly Tab[]
  onKeep: (tab: SessionTab) => SessionTab
  onNavigate: (tab: SessionTab, preview: boolean) => void
  onDiscard: (tab: SessionTab) => void
}) {
  const [state, setState] = createStore<{ tab: SessionTab | undefined }>({ tab: undefined })

  const release = () => {
    const tab = state.tab

    setState("tab", undefined)

    return tab
  }

  const clear = () => {
    const tab = release()

    if (tab) options.onDiscard(tab)

    return tab
  }

  const find = (input: Omit<SessionTab, "type">) =>
    options
      .tabs()
      .find(
        (tab): tab is SessionTab =>
          tab.type === "session" && tab.server === input.server && tab.sessionId === input.sessionId,
      )

  return {
    current: () => state.tab,
    release,
    clear,
    activate(tab: Tab) {
      if (
        state.tab &&
        (tab.type !== "session" || tab.server !== state.tab.server || tab.sessionId !== state.tab.sessionId)
      )
        clear()
    },
    open(input: Omit<SessionTab, "type">) {
      const existing = find(input)

      if (existing) {
        clear()
        options.onNavigate(existing, false)

        return existing
      }

      const current = state.tab

      const tab =
        current?.server === input.server && current.sessionId === input.sessionId
          ? current
          : { type: "session" as const, ...input }

      if (tab !== current) {
        clear()
        setState("tab", tab)
      }

      options.onNavigate(tab, true)

      return tab
    },
    keep(tab = state.tab) {
      if (!tab) return

      if (state.tab?.server === tab.server && state.tab.sessionId === tab.sessionId) release()

      return find(tab) ?? options.onKeep(tab)
    },
    setRoute(sessionId: string, parentId?: string) {
      if (!state.tab) return
      setState("tab", "routeSessionId", sessionId === state.tab.sessionId ? undefined : sessionId)
      setState("tab", "routeParentId", sessionId === state.tab.sessionId ? undefined : parentId)
    },
  }
}
