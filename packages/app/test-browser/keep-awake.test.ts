import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "@/shell/tabs/tabs"
import { createOpenTabsKeepAwake } from "../src/shell/keep-awake"

const local = ServerConnection.key({ type: "http", http: { url: "http://localhost:4096" } })
const remote = ServerConnection.key({ type: "http", http: { url: "https://example.com" } })
const session = (sessionId: string, server = local): Tab => ({ type: "session", server, sessionId })

function setup(tabs: Tab[] = []) {
  const calls: boolean[] = []
  const owned = createRoot((dispose) => {
    const [store, setStore] = createStore({
      tabs,
      running: {} as Record<string, Record<string, boolean>>,
    })
    createOpenTabsKeepAwake({
      tabs: () => store.tabs,
      running: (server, sessionID) => store.running[server]?.[sessionID] ?? false,
      setActive: async (active) => {
        calls.push(active)
      },
    })
    return { dispose, setStore }
  })
  return { ...owned, calls }
}

describe("open session tab keep-awake", () => {
  test("ignores drafts and running sessions without an open tab", () => {
    const state = setup([{ type: "draft", server: local, draftID: "draft", directory: "/project" }])
    state.setStore("running", local, { draft: true, closed: true })
    expect(state.calls).toEqual([false])
    state.dispose()
  })

  test("counts every tab, not just the first or selected tab", () => {
    const state = setup([session("idle"), session("background")])
    state.setStore("running", local, { background: true })
    expect(state.calls).toEqual([false, true])
    state.setStore("tabs", [session("background"), session("idle")])
    expect(state.calls).toEqual([false, true])
    state.dispose()
    expect(state.calls).toEqual([false, true, false])
  })

  test("closing the last running tab releases without stopping its execution", () => {
    const state = setup([session("a"), session("b")])
    state.setStore("running", local, { a: true, b: true })
    state.setStore("tabs", [session("b")])
    expect(state.calls).toEqual([false, true])
    state.setStore("tabs", [])
    expect(state.calls).toEqual([false, true, false])
    state.setStore("tabs", [session("a")])
    expect(state.calls).toEqual([false, true, false, true])
    state.dispose()
  })

  test("releases when the last session finishes and follows refreshed activity", () => {
    const state = setup([session("a"), session("b")])
    state.setStore("running", local, { a: true, b: true })
    state.setStore("running", local, "a", false)
    expect(state.calls).toEqual([false, true])
    state.setStore("running", local, "b", false)
    expect(state.calls).toEqual([false, true, false])
    state.setStore("running", local, "b", true)
    expect(state.calls).toEqual([false, true, false, true])
    state.dispose()
  })

  test("scopes session identity to its server", () => {
    const state = setup([session("same", remote)])
    state.setStore("running", local, { same: true })
    expect(state.calls).toEqual([false])
    state.setStore("running", remote, { same: true })
    expect(state.calls).toEqual([false, true])
    state.dispose()
  })

  test("counts the child session currently represented by a root tab", () => {
    const state = setup([{ type: "session", server: local, sessionId: "root", routeSessionId: "child" }])
    state.setStore("running", local, { child: true })
    expect(state.calls).toEqual([false, true])
    state.setStore("tabs", [session("root")])
    expect(state.calls).toEqual([false, true, false])
    state.dispose()
  })
})
