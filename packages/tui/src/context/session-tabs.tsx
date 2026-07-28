import { batch, createEffect, onCleanup, untrack } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import path from "path"
import { isDeepEqual } from "remeda"
import { createSimpleContext } from "./helper"
import { useData } from "./data"
import { useEvent } from "./event"
import { useRoute } from "./route"
import { useTuiPaths } from "./runtime"
import { useConfig } from "../config"
import { readJson, writeJsonAtomic } from "../util/persistence"
import { isRecord } from "../util/record"
import {
  closeSessionTab,
  cycleSessionTab,
  openSessionTab,
  type SessionTab,
  type SessionTabUnread,
} from "./session-tabs-model"

type PersistedState = {
  tabs: SessionTab[]
  unread: Record<string, SessionTabUnread>
}

export const { use: useSessionTabs, provider: SessionTabsProvider } = createSimpleContext({
  name: "SessionTabs",
  init: () => {
    const route = useRoute()
    const data = useData()
    const event = useEvent()
    const config = useConfig().data
    const filePath = path.join(useTuiPaths().state, "session-tabs.json")
    const enabled = () => config.session?.tabs ?? false
    const state: {
      pending: boolean
      saving: boolean
      snapshot: string
      value?: PersistedState
    } = { pending: false, saving: false, snapshot: "" }
    const [store, setStore] = createStore<PersistedState & { ready: boolean }>({
      ready: false,
      tabs: [],
      unread: {},
    })

    const root = (sessionID: string) => data.session.root(sessionID)
    const current = () => (route.data.type === "session" ? root(route.data.sessionID) : undefined)
    const family = (sessionID: string) => {
      const session = root(sessionID)
      const members = data.session.family(session)
      return members.length > 0 ? members : [session]
    }
    const attention = (sessionID: string) =>
      family(sessionID).some(
        (id) => (data.session.permission.list(id)?.length ?? 0) > 0 || (data.session.form.list(id)?.length ?? 0) > 0,
      )

    function save() {
      if (!store.ready) {
        state.pending = true
        return
      }
      const value = { tabs: [...store.tabs], unread: { ...store.unread } }
      const snapshot = JSON.stringify(value)
      if (snapshot === state.snapshot && !state.saving) return
      state.value = value
      state.pending = true
      flush()
    }

    function flush() {
      if (state.saving || !state.pending || !state.value) return
      const value = state.value
      const snapshot = JSON.stringify(value)
      state.pending = false
      if (snapshot === state.snapshot) return
      state.saving = true
      void writeJsonAtomic(filePath, value)
        .then(() => {
          state.snapshot = snapshot
        })
        .catch(() => {})
        .finally(() => {
          state.saving = false
          flush()
        })
    }

    function open(sessionID: string) {
      const session = root(sessionID)
      setStore(
        "tabs",
        reconcile(openSessionTab(store.tabs, { sessionID: session, title: data.session.get(session)?.title })),
      )
      return session
    }

    function clearUnread(sessionID: string) {
      const session = root(sessionID)
      if (!store.unread[session]) return
      setStore(
        "unread",
        produce((draft) => {
          delete draft[session]
        }),
      )
    }

    function markUnread(sessionID: string, unread: SessionTabUnread) {
      if (!enabled()) return
      const session = root(sessionID)
      if (current() === session || !store.tabs.some((tab) => tab.sessionID === session)) return
      if (store.unread[session] === unread) return
      setStore("unread", session, unread)
      save()
    }

    readJson<unknown>(filePath)
      .then((value) => {
        if (!isRecord(value)) return
        const persisted = value
        if (Array.isArray(persisted.tabs))
          setStore(
            "tabs",
            persisted.tabs.flatMap((tab) => {
              if (!isRecord(tab) || typeof tab.sessionID !== "string") return []
              if ("title" in tab && tab.title !== undefined && typeof tab.title !== "string") return []
              return [{ sessionID: tab.sessionID, title: typeof tab.title === "string" ? tab.title : undefined }]
            }),
          )
        if (persisted.unread && typeof persisted.unread === "object")
          setStore(
            "unread",
            Object.fromEntries(
              Object.entries(persisted.unread).filter(
                (entry): entry is [string, SessionTabUnread] => entry[1] === "activity" || entry[1] === "error",
              ),
            ),
          )
      })
      .catch(() => {})
      .finally(() => {
        setStore("ready", true)
        if (state.pending) save()
        else state.snapshot = JSON.stringify({ tabs: store.tabs, unread: store.unread })
      })

    createEffect(() => {
      if (!enabled()) return
      if (!store.ready || route.data.type !== "session" || route.data.sessionID === "dummy") return
      const routeSessionID = route.data.sessionID
      batch(() => {
        const sessionID = open(routeSessionID)
        clearUnread(sessionID)
      })
      untrack(save)
    })

    createEffect(() => {
      if (!enabled() || !store.ready) return
      const next = store.tabs.reduce((tabs, tab) => {
        const sessionID = root(tab.sessionID)
        return openSessionTab(tabs, { sessionID, title: data.session.get(sessionID)?.title ?? tab.title })
      }, [] as SessionTab[])
      const unread = Object.entries(store.unread).reduce<Record<string, SessionTabUnread>>((result, entry) => {
        const sessionID = root(entry[0])
        result[sessionID] = result[sessionID] === "error" ? "error" : entry[1]
        return result
      }, {})
      if (isDeepEqual(next, store.tabs) && isDeepEqual(unread, store.unread)) return
      batch(() => {
        setStore("tabs", reconcile(next))
        setStore("unread", reconcile(unread))
      })
      save()
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
      const closed = closeSessionTab(store.tabs, target)
      if (closed.tabs.length === store.tabs.length) return
      batch(() => {
        setStore("tabs", reconcile(closed.tabs))
        clearUnread(target)
        if (navigate && current() === target)
          route.navigate(closed.next ? { type: "session", sessionID: closed.next } : { type: "home" })
      })
      save()
    }

    return {
      enabled,
      tabs() {
        return store.tabs
      },
      current,
      unread(sessionID: string) {
        return store.unread[root(sessionID)]
      },
      attention(sessionID: string) {
        return attention(sessionID)
      },
      busy(sessionID: string) {
        return family(sessionID).some(
          (id) => data.session.status(id) === "running" || data.session.pending.list(id).length > 0,
        )
      },
      select(sessionID: string) {
        if (!enabled()) return
        route.navigate({ type: "session", sessionID: root(sessionID) })
      },
      close(sessionID?: string) {
        if (!enabled()) return
        const target = sessionID ? root(sessionID) : current()
        if (!target) {
          const previous = store.tabs.at(-1)
          if (route.data.type === "home" && previous) route.navigate({ type: "session", sessionID: previous.sessionID })
          return
        }
        remove(target, true)
      },
      cycle(direction: 1 | -1) {
        if (!enabled()) return
        const tab = cycleSessionTab(store.tabs, current(), direction)
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
      cycleUnread(direction: 1 | -1) {
        if (!enabled()) return
        const tab = cycleSessionTab(
          store.tabs.filter((tab) => store.unread[tab.sessionID] || attention(tab.sessionID)),
          current(),
          direction,
        )
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
      selectIndex(index: number) {
        if (!enabled()) return
        const tab = store.tabs[index]
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
    }
  },
})
