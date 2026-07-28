import { batch, createEffect, onCleanup } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import path from "path"
import { createSimpleContext } from "./helper"
import { useData } from "./data"
import { useEvent } from "./event"
import { useRoute } from "./route"
import { useTuiPaths } from "./runtime"
import { readJson, writeJsonAtomic } from "../util/persistence"
import { closeSessionTab, openSessionTab, type SessionTab, type SessionTabUnread } from "./session-tabs-model"

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
    const filePath = path.join(useTuiPaths().state, "session-tabs.json")
    const state = { pending: false }
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

    function save() {
      if (!store.ready) {
        state.pending = true
        return
      }
      state.pending = false
      void writeJsonAtomic(filePath, { tabs: store.tabs, unread: store.unread })
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
      const session = root(sessionID)
      if (current() === session || !store.tabs.some((tab) => tab.sessionID === session)) return
      setStore("unread", session, unread)
      save()
    }

    readJson<unknown>(filePath)
      .then((value) => {
        if (!value || typeof value !== "object") return
        const persisted = value as Record<string, unknown>
        if (Array.isArray(persisted.tabs))
          setStore(
            "tabs",
            persisted.tabs.flatMap((tab) => {
              if (!tab || typeof tab !== "object" || !("sessionID" in tab) || typeof tab.sessionID !== "string")
                return []
              if ("title" in tab && tab.title !== undefined && typeof tab.title !== "string") return []
              return [{ sessionID: tab.sessionID, title: "title" in tab ? tab.title : undefined }]
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
      })

    createEffect(() => {
      if (!store.ready || route.data.type !== "session" || route.data.sessionID === "dummy") return
      const routeSessionID = route.data.sessionID
      batch(() => {
        const sessionID = open(routeSessionID)
        clearUnread(sessionID)
      })
      save()
    })

    createEffect(() => {
      if (!store.ready) return
      const next = store.tabs.reduce((tabs, tab) => {
        const sessionID = root(tab.sessionID)
        return openSessionTab(tabs, { sessionID, title: data.session.get(sessionID)?.title ?? tab.title })
      }, [] as SessionTab[])
      const unread = Object.entries(store.unread).reduce<Record<string, SessionTabUnread>>((result, entry) => {
        const sessionID = root(entry[0])
        result[sessionID] = result[sessionID] === "error" ? "error" : entry[1]
        return result
      }, {})
      if (
        JSON.stringify(next) === JSON.stringify(store.tabs) &&
        JSON.stringify(unread) === JSON.stringify(store.unread)
      )
        return
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
        const sessionID = root(evt.data.sessionID)
        const closed = closeSessionTab(store.tabs, sessionID)
        if (closed.tabs.length === store.tabs.length) return
        batch(() => {
          setStore("tabs", reconcile(closed.tabs))
          clearUnread(sessionID)
          if (current() === sessionID)
            route.navigate(closed.next ? { type: "session", sessionID: closed.next } : { type: "home" })
        })
        save()
      }),
    )

    return {
      tabs() {
        return store.tabs
      },
      current,
      unread(sessionID: string) {
        return store.unread[root(sessionID)]
      },
      attention(sessionID: string) {
        return family(sessionID).some(
          (id) => (data.session.permission.list(id)?.length ?? 0) > 0 || (data.session.form.list(id)?.length ?? 0) > 0,
        )
      },
      running(sessionID: string) {
        return family(sessionID).some((id) => data.session.status(id) === "running")
      },
      select(sessionID: string) {
        route.navigate({ type: "session", sessionID: open(sessionID) })
        save()
      },
      close(sessionID?: string) {
        const target = sessionID ? root(sessionID) : current()
        if (!target) return
        const closed = closeSessionTab(store.tabs, target)
        if (closed.tabs.length === store.tabs.length) return
        batch(() => {
          setStore("tabs", reconcile(closed.tabs))
          clearUnread(target)
          if (current() === target)
            route.navigate(closed.next ? { type: "session", sessionID: closed.next } : { type: "home" })
        })
        save()
      },
      cycle(direction: 1 | -1) {
        if (store.tabs.length === 0) return
        const index = store.tabs.findIndex((tab) => tab.sessionID === current())
        const start = index === -1 ? (direction === 1 ? -1 : 0) : index
        const tab = store.tabs[(start + direction + store.tabs.length) % store.tabs.length]
        if (tab) route.navigate({ type: "session", sessionID: tab.sessionID })
      },
    }
  },
})
