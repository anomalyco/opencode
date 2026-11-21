import { createSignal } from "solid-js"
import type { SessionTab, Tab } from "./tabs"
import {
  currentPreview,
  INITIAL_PREVIEW_STATE,
  matchesPreview,
  transitionPreview,
  type PreviewEvent,
} from "./preview-machine"

export function createSessionPreview(options: {
  tabs: () => readonly Tab[]
  onKeep: (tab: SessionTab) => SessionTab
  onNavigate: (tab: SessionTab, preview: boolean) => void
  onDiscard: (tab: SessionTab) => void
}) {
  const [state, setState] = createSignal(INITIAL_PREVIEW_STATE)

  const current = () => currentPreview(state())

  const dispatch = (event: PreviewEvent) => {
    const previous = state()

    const next = transitionPreview(previous, event)

    if (next !== previous) setState(next)
  }

  const release = () => {
    const tab = current()

    dispatch({ type: "release" })

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
    current,
    release,
    clear,
    activate(tab: Tab) {
      const previous = current()

      dispatch({ type: "activate", tab })

      if (previous && previous !== current()) options.onDiscard(previous)
    },
    open(input: Omit<SessionTab, "type">) {
      const existing = find(input)

      if (existing) {
        clear()
        options.onNavigate(existing, false)

        return existing
      }

      const active = current()

      const tab = active && matchesPreview(state(), input) ? active : { type: "session" as const, ...input }

      if (tab !== current()) {
        clear()
        dispatch({ type: "open", tab })
      }

      options.onNavigate(tab, true)

      return tab
    },
    keep(tab = current()) {
      if (!tab) return

      const active = current()

      const target = active && matchesPreview(state(), tab) ? active : tab

      dispatch({ type: "keep", tab: target })

      return find(target) ?? options.onKeep(target)
    },
    setRoute(sessionId: string, parentId?: string) {
      dispatch({ type: "route", sessionId, parentId })
    },
  }
}
