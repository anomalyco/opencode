import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { createTabState } from "./tab-state"
import { Tab as TabApi } from "@/tab"
import { Log } from "@/util/log"
import { onMount } from "solid-js"

export type { Tab, TabContext } from "./tab-state"
export { createTabState } from "./tab-state"

export const { use: useTabs, provider: TabProvider } = createSimpleContext({
  name: "Tabs",
  init: () => {
    const sdk = useSDK()
    const state = createTabState()

    const fail = (op: string) => (e: unknown) =>
      Log.Default.error("tab sync failed", { op, error: e instanceof Error ? e.message : String(e) })

    let pending = 0

    onMount(async () => {
      const res = await sdk.client.tab.list()
      if (res.data) state.load(res.data)
    })

    // Subscribe to server-side tab events
    sdk.event.on(TabApi.Event.Updated.type, (evt) => {
      const info = evt.properties as TabApi.Info
      const existing = state.tabs().find((t) => t.id === info.id)
      if (existing) {
        if (info.label !== existing.label) state.rename(info.id, info.label)
        if (info.sessionID && info.sessionID !== existing.sessionID) state.updateSessionID(info.id, info.sessionID)
        if (info.directory && info.directory !== existing.directory) state.updateDirectory(info.id, info.directory)
        const routeChanged =
          info.route.type !== existing.route.type ||
          (info.route.type === "session" &&
            existing.route.type === "session" &&
            info.route.sessionID !== existing.route.sessionID)
        if (routeChanged) state.updateRoute(info.id, info.route)
        return
      }
      if (pending > 0) return
      // Tab created server-side (e.g. by the tab tool) — reload full state
      sdk.client.tab.list().then((r) => {
        if (r.data) state.load(r.data)
      })
    })

    sdk.event.on(TabApi.Event.Activated.type, (evt) => {
      const props = evt.properties as { id: string; previousID: string | null }
      const current = state.active()
      if (current.id !== props.id) {
        state.activate(props.id)
      }
    })

    sdk.event.on(TabApi.Event.PositionChanged.type, (evt) => {
      const props = evt.properties as { position: "top" | "bottom" }
      if (state.position() !== props.position) {
        state.setPosition(props.position)
      }
    })

    // Wrap mutations to sync with server
    const origAdd = state.add.bind(state)
    const origClose = state.close.bind(state)
    const origActivate = state.activate.bind(state)
    const origLast = state.last.bind(state)
    const origRename = state.rename.bind(state)
    const origSetPosition = state.setPosition.bind(state)
    const origUpdateSessionID = state.updateSessionID.bind(state)
    const origUpdateDirectory = state.updateDirectory.bind(state)

    state.add = (opts) => {
      const id = origAdd(opts)
      pending++
      sdk.client.tab
        .add({
          sessionID: opts?.sessionID,
          body_directory: opts?.directory,
          label: opts?.label,
        })
        .then((res) => {
          pending--
          if (res.data) {
            // Reload from server to get server-generated IDs
            sdk.client.tab.list().then((r) => {
              if (r.data) state.load(r.data)
            })
          }
        })
        .catch((e) => {
          pending--
          fail("add")(e)
        })
      return id
    }

    state.close = (id) => {
      origClose(id)
      sdk.client.tab.remove({ id }).catch(fail("close"))
    }

    state.activate = (id) => {
      origActivate(id)
      sdk.client.tab.activate({ id }).catch(fail("activate"))
    }

    state.last = () => {
      origLast()
      sdk.client.tab.last().catch(fail("last"))
    }

    state.rename = (id, label) => {
      origRename(id, label)
      sdk.client.tab.update({ id, label }).catch(fail("rename"))
    }

    state.setPosition = (p) => {
      origSetPosition(p)
      sdk.client.tab.setPosition({ position: p }).catch(fail("setPosition"))
    }

    state.updateSessionID = (id, sessionID) => {
      origUpdateSessionID(id, sessionID)
      sdk.client.tab.update({ id, sessionID }).catch(fail("updateSessionID"))
    }

    state.updateDirectory = (id, directory) => {
      origUpdateDirectory(id, directory)
      sdk.client.tab.update({ id, body_directory: directory }).catch(fail("updateDirectory"))
    }

    return state
  },
})
