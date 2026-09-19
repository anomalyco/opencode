import { describe, expect, test } from "bun:test"
import type { Route } from "@opencode/plugin/tui/context"
import { createPluginContext, type Registry, type usePluginHost } from "../src/plugin/api"

type Host = ReturnType<typeof usePluginHost>
type Shown = Parameters<Host["toast"]["show"]>[0]

const sessions: Record<string, { id: string; title?: string; parentID?: string }> = {
  parent: { id: "parent", title: "Parent session" },
  child: { id: "child", title: "Child session", parentID: "parent" },
  other: { id: "other", title: "Other session" },
  untitled: { id: "untitled" },
}

const root = (sessionID: string): string => {
  const parentID = sessions[sessionID]?.parentID
  return parentID ? root(parentID) : sessionID
}

function setup(route: Route) {
  const shown: Shown[] = []
  const navigated: Route[] = []
  const host = {
    app: { version: "test", channel: "test" },
    client: { api: {} },
    keymap: {},
    shortcuts: {},
    keymapState: {},
    sessionTabs: {},
    toast: { show: (toast: Shown) => shown.push(toast) },
    route: {
      get data() {
        return route
      },
      navigate: (destination: Route) => navigated.push(destination),
    },
    data: { session: { root, get: (sessionID: string) => sessions[sessionID] } },
  } as unknown as Host
  const registry: Registry = { has: () => false, set() {}, remove() {}, active: () => true }
  const context = createPluginContext({ host, id: "test", options: undefined, owned: [], registry })
  return { shown, navigated, toast: context.ui.toast }
}

describe("plugin session-scoped toasts", () => {
  test("unscoped toasts pass through with the default variant", () => {
    const harness = setup({ type: "home" })
    harness.toast.show({ message: "hello" })
    expect(harness.shown).toEqual([{ title: undefined, message: "hello", variant: "info", duration: undefined }])
  })

  test("shows as-is while the session is open", () => {
    const harness = setup({ type: "session", sessionID: "parent" })
    harness.toast.show({ sessionID: "parent", message: "done", variant: "success" })
    expect(harness.shown).toEqual([{ title: undefined, message: "done", variant: "success", duration: undefined }])
  })

  test.each([
    ["subagent toast while parent is open", "parent", "child"],
    ["parent toast while subagent is open", "child", "parent"],
  ])("%s counts as local", (_, routed, target) => {
    const harness = setup({ type: "session", sessionID: routed })
    harness.toast.show({ sessionID: target, message: "done" })
    expect(harness.shown[0]).not.toHaveProperty("action")
  })

  test.each<Route>([{ type: "home" }, { type: "session", sessionID: "parent" }])(
    "adds the session title and an Open action when the session is not open (%j)",
    (route) => {
      const harness = setup(route)
      harness.toast.show({ sessionID: "other", message: "done", variant: "success", duration: 1000 })
      expect(harness.shown).toHaveLength(1)
      expect(harness.shown[0]).toMatchObject({
        title: "Other session",
        message: "done",
        variant: "success",
        duration: 1000,
        action: { label: "Open" },
      })
      harness.shown[0].action?.run()
      expect(harness.navigated).toEqual([{ type: "session", sessionID: "other" }])
    },
  )

  test("keeps an explicit title when the session is not open", () => {
    const harness = setup({ type: "home" })
    harness.toast.show({ sessionID: "other", title: "Build finished", message: "done" })
    expect(harness.shown[0].title).toBe("Build finished")
  })

  test("leaves the title empty for an untitled session that is not open", () => {
    const harness = setup({ type: "home" })
    harness.toast.show({ sessionID: "untitled", message: "done" })
    expect(harness.shown[0].title).toBeUndefined()
    expect(harness.shown[0].action?.label).toBe("Open")
  })
})
