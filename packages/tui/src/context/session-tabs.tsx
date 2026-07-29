import { createEffect, onCleanup } from "solid-js"
import { isDeepEqual } from "remeda"
import { createSimpleContext } from "./helper"
import { useData } from "./data"
import { useEvent } from "./event"
import { useRoute } from "./route"
import { useConfig } from "../config"
import { useStorage } from "./storage"
import { useTuiPaths } from "./runtime"
import {
  closeSessionTab,
  cycleSessionTab,
  moveSessionTab,
  moveSessionTabHistory,
  openSessionTab,
  recordSessionTabHistory,
  type SessionTab,
  type SessionTabHistory,
  type SessionTabUnread,
} from "./session-tabs-model"

type TabsState = {
  tabs: SessionTab[]
  unread: Record<string, SessionTabUnread>
}

type PersistedState = {
  global: TabsState
  cwd: Record<string, TabsState>
}

const empty = (): TabsState => ({ tabs: [], unread: {} })

export const { use: useSessionTabs, provider: SessionTabsProvider } = createSimpleContext({
  name: "SessionTabs",
  init: () => {
    const route = useRoute()
    const data = useData()
    const event = useEvent()
    const config = useConfig().data
    const paths = useTuiPaths()
    const enabled = () => config.tabs?.enabled ?? false
    // Keyed reconcile keeps tab object identity across reorders, so strip rows move instead of
    // mutating in place, which per-row animations and drag state depend on.
    const [store, updateStore] = useStorage().store<PersistedState>("tabs", {
      initial: {
        global: empty(),
        cwd: {},
      },
      key: "sessionID",
    })
    const fallback = empty()
    let history: SessionTabHistory = { entries: [], index: -1 }

    function state() {
      if (config.tabs?.scope === "global") return store.global
      return store.cwd[paths.cwd] ?? fallback
    }

    function update(mutation: (draft: TabsState) => void) {
      const scope = config.tabs?.scope ?? "cwd"
      void updateStore((draft) => mutation(scope === "cwd" ? (draft.cwd[paths.cwd] ??= empty()) : draft.global)).catch(
        () => {},
      )
    }

    const root = (sessionID: string) => data.session.root(sessionID)
    const current = () => (route.data.type === "session" ? root(route.data.sessionID) : undefined)
    const status = (sessionID: string) => {
      const session = root(sessionID)
      const members = data.session.family(session)
      const family = members.length > 0 ? members : [session]
      return {
        unread: state().unread[session],
        attention: family.some(
          (id) => (data.session.permission.list(id)?.length ?? 0) > 0 || (data.session.form.list(id)?.length ?? 0) > 0,
        ),
        busy: family.some((id) => data.session.status(id) === "running" || data.session.pending.list(id).length > 0),
      }
    }

    function markUnread(sessionID: string, unread: SessionTabUnread) {
      if (!enabled()) return
      const session = root(sessionID)
      if (current() === session || !state().tabs.some((tab) => tab.sessionID === session)) return
      if (state().unread[session] === unread) return
      update((draft) => {
        if (!draft.tabs.some((tab) => tab.sessionID === session)) return
        draft.unread[session] = unread
      })
    }

    createEffect(() => {
      if (!enabled()) return
      if (route.data.type !== "session" || route.data.sessionID === "dummy") return
      const sessionID = root(route.data.sessionID)
      history = recordSessionTabHistory(history, sessionID)
      const title = data.session.get(sessionID)?.title
      const tabs = openSessionTab(state().tabs, { sessionID, title })
      if (tabs === state().tabs && !state().unread[sessionID]) return
      update((draft) => {
        draft.tabs = openSessionTab(draft.tabs, { sessionID, title })
        delete draft.unread[sessionID]
      })
    })

    createEffect(() => {
      if (!enabled()) return
      const next = state().tabs.reduce<SessionTab[]>((tabs, tab) => {
        const sessionID = root(tab.sessionID)
        return openSessionTab(tabs, { sessionID, title: data.session.get(sessionID)?.title ?? tab.title })
      }, [])
      const unread = Object.entries(state().unread).reduce<Record<string, SessionTabUnread>>((result, entry) => {
        const sessionID = root(entry[0])
        result[sessionID] = result[sessionID] === "error" ? "error" : entry[1]
        return result
      }, {})
      if (isDeepEqual(next, state().tabs) && isDeepEqual(unread, state().unread)) return
      update((draft) => {
        draft.tabs = draft.tabs.reduce<SessionTab[]>((tabs, tab) => {
          const sessionID = root(tab.sessionID)
          return openSessionTab(tabs, { sessionID, title: data.session.get(sessionID)?.title ?? tab.title })
        }, [])
        draft.unread = Object.entries(draft.unread).reduce<Record<string, SessionTabUnread>>((result, entry) => {
          const sessionID = root(entry[0])
          result[sessionID] = result[sessionID] === "error" ? "error" : entry[1]
          return result
        }, {})
      })
    })

    onCleanup(event.on("session.execution.succeeded", (evt) => markUnread(evt.data.sessionID, "activity")))
    onCleanup(event.on("session.execution.interrupted", (evt) => markUnread(evt.data.sessionID, "activity")))
    onCleanup(event.on("session.execution.failed", (evt) => markUnread(evt.data.sessionID, "error")))
    onCleanup(
      event.on("session.error", (evt) => {
        if (evt.data.sessionID) markUnread(evt.data.sessionID, "error")
      }),
    )
    onCleanup(
      event.on("session.deleted", (evt) => {
        remove(evt.data.sessionID, enabled())
      }),
    )

    function remove(sessionID: string, navigate: boolean) {
      const target = root(sessionID)
      const closed = closeSessionTab(state().tabs, target)
      if (closed.tabs.length === state().tabs.length) return
      const selected = navigate && current() === target
      const previous = selected
        ? moveSessionTabHistory(recordSessionTabHistory(history, target), closed.tabs, target, -1)
        : { history, sessionID: undefined }
      const next = previous.sessionID ?? closed.next
      history = previous.history
      update((draft) => {
        draft.tabs = closeSessionTab(draft.tabs, target).tabs
        delete draft.unread[target]
      })
      if (selected) route.navigate(next ? { type: "session", sessionID: next } : { type: "home" })
    }

    return {
      enabled,
      tabs() {
        return state().tabs
      },
      current,
      status,
      select(sessionID: string) {
        if (!enabled()) return
        route.navigate({ type: "session", sessionID: root(sessionID) })
      },
      close(sessionID?: string) {
        if (!enabled()) return
        const target = sessionID ? root(sessionID) : current()
        if (!target) {
          const previous = state().tabs.at(-1)
          if (route.data.type === "home" && previous) route.navigate({ type: "session", sessionID: previous.sessionID })
          return
        }
        remove(target, true)
      },
      move(sessionID: string, index: number) {
        if (!enabled()) return
        const session = root(sessionID)
        if (moveSessionTab(state().tabs, session, index) === state().tabs) return
        update((draft) => {
          draft.tabs = moveSessionTab(draft.tabs, session, index)
        })
      },
      cycle(direction: 1 | -1) {
        if (!enabled()) return
        const tab = cycleSessionTab(state().tabs, current(), direction)
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
      cycleUnread(direction: 1 | -1) {
        if (!enabled()) return
        const tab = cycleSessionTab(
          state().tabs.filter((tab) => state().unread[tab.sessionID] || status(tab.sessionID).attention),
          current(),
          direction,
        )
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
      history(direction: 1 | -1) {
        if (!enabled()) return
        const next = moveSessionTabHistory(history, state().tabs, current(), direction)
        history = next.history
        if (next.sessionID) route.navigate({ type: "session", sessionID: next.sessionID })
      },
      selectIndex(index: number) {
        if (!enabled()) return
        const tab = state().tabs[index]
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
    }
  },
})
