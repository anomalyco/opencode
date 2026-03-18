import { describe, expect, test, beforeEach } from "bun:test"
import { createRoot } from "solid-js"
import { createTabState, resetTabID, type Route } from "../../../../src/cli/cmd/tui/context/tab-state"

describe("createTabState", () => {
  beforeEach(() => {
    resetTabID()
  })

  describe("initial state", () => {
    test("single tab exists on creation", () => {
      createRoot((dispose) => {
        const state = createTabState()
        expect(state.tabs()).toHaveLength(1)
        dispose()
      })
    })

    test("initial tab label is Untitled", () => {
      createRoot((dispose) => {
        const state = createTabState()
        expect(state.tabs()[0].label).toBe("Untitled")
        dispose()
      })
    })

    test("initial tab route is home", () => {
      createRoot((dispose) => {
        const state = createTabState()
        expect(state.tabs()[0].route).toEqual({ type: "home" })
        dispose()
      })
    })

    test("initial tab sessionID is null", () => {
      createRoot((dispose) => {
        const state = createTabState()
        expect(state.tabs()[0].sessionID).toBeNull()
        dispose()
      })
    })

    test("active tab is the initial tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        expect(state.active().id).toBe(state.tabs()[0].id)
        expect(state.activeIndex()).toBe(0)
        dispose()
      })
    })
  })

  describe("add", () => {
    test("default label is Untitled when no options provided", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.add()
        expect(state.tabs()[1].label).toBe("Untitled")
        dispose()
      })
    })

    test("custom label used when label option given", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.add({ label: "My Tab" })
        expect(state.tabs()[1].label).toBe("My Tab")
        dispose()
      })
    })

    test("route is home when no sessionID", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.add()
        expect(state.tabs()[1].route).toEqual({ type: "home" })
        dispose()
      })
    })

    test("route is session when sessionID provided", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.add({ sessionID: "ses_123" })
        expect(state.tabs()[1].route).toEqual({ type: "session", sessionID: "ses_123" })
        dispose()
      })
    })

    test("new tab becomes the active tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.add()
        expect(state.active().id).toBe(id)
        dispose()
      })
    })

    test("tab count increments", () => {
      createRoot((dispose) => {
        const state = createTabState()
        expect(state.tabs()).toHaveLength(1)
        state.add()
        expect(state.tabs()).toHaveLength(2)
        state.add()
        expect(state.tabs()).toHaveLength(3)
        dispose()
      })
    })
  })

  describe("close", () => {
    test("prevents closing when only 1 tab remains", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.tabs()[0].id
        state.close(id)
        expect(state.tabs()).toHaveLength(1)
        dispose()
      })
    })

    test("removes tab when multiple exist", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const secondID = state.add()
        expect(state.tabs()).toHaveLength(2)
        state.close(secondID)
        expect(state.tabs()).toHaveLength(1)
        dispose()
      })
    })

    test("activates neighbor when closing active tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const firstID = state.tabs()[0].id
        const secondID = state.add()
        expect(state.active().id).toBe(secondID)
        state.close(secondID)
        expect(state.active().id).toBe(firstID)
        dispose()
      })
    })

    test("no-op for non-existent tab ID", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.add()
        expect(state.tabs()).toHaveLength(2)
        state.close("nonexistent")
        expect(state.tabs()).toHaveLength(2)
        dispose()
      })
    })
  })

  describe("activate", () => {
    test("switches active tab by ID", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const firstID = state.tabs()[0].id
        state.add()
        expect(state.active().id).not.toBe(firstID)
        state.activate(firstID)
        expect(state.active().id).toBe(firstID)
        dispose()
      })
    })

    test("no-op for non-existent ID", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const activeID = state.active().id
        state.activate("nonexistent")
        expect(state.active().id).toBe(activeID)
        dispose()
      })
    })
  })

  describe("rename", () => {
    test("updates label of specified tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.tabs()[0].id
        state.rename(id, "Renamed")
        expect(state.tabs()[0].label).toBe("Renamed")
        dispose()
      })
    })
  })

  describe("last", () => {
    test("no-op when no history", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const activeID = state.active().id
        state.last()
        expect(state.active().id).toBe(activeID)
        dispose()
      })
    })

    test("switches to previously active tab after add", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const firstID = state.tabs()[0].id
        state.add()
        state.last()
        expect(state.active().id).toBe(firstID)
        dispose()
      })
    })

    test("toggles between two tabs", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const firstID = state.tabs()[0].id
        const secondID = state.add()
        expect(state.active().id).toBe(secondID)
        state.last()
        expect(state.active().id).toBe(firstID)
        state.last()
        expect(state.active().id).toBe(secondID)
        dispose()
      })
    })

    test("previousID set when adding a tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const firstID = state.tabs()[0].id
        state.add()
        expect(state.previousID()).toBe(firstID)
        dispose()
      })
    })

    test("previousID cleared when previous tab is closed", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const firstID = state.tabs()[0].id
        const secondID = state.add()
        state.activate(firstID)
        expect(state.previousID()).toBe(secondID)
        state.close(secondID)
        expect(state.previousID()).toBeNull()
        dispose()
      })
    })

    test("activate same tab does not change history", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const firstID = state.tabs()[0].id
        state.add()
        const prevBefore = state.previousID()
        state.activate(state.active().id)
        expect(state.previousID()).toBe(prevBefore)
        dispose()
      })
    })

    test("activate already-active tab still calls navigator", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const secondID = state.add({ sessionID: "ses_1" })
        const navigated: Route[] = []
        state._setNavigator((r) => navigated.push(r))
        state.activate(secondID)
        expect(navigated).toHaveLength(1)
        expect(navigated[0]).toEqual({ type: "session", sessionID: "ses_1" })
        dispose()
      })
    })
  })

  describe("position", () => {
    test("defaults to bottom", () => {
      createRoot((dispose) => {
        const state = createTabState()
        expect(state.position()).toBe("bottom")
        dispose()
      })
    })

    test("setPosition updates position", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.setPosition("top")
        expect(state.position()).toBe("top")
        dispose()
      })
    })

    test("initial position can be overridden", () => {
      createRoot((dispose) => {
        const state = createTabState({ position: "top" })
        expect(state.position()).toBe("top")
        dispose()
      })
    })
  })

  describe("updateRoute", () => {
    test("sets session route on tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.tabs()[0].id
        state.updateRoute(id, { type: "session", sessionID: "ses_abc" })
        expect(state.tabs()[0].route).toEqual({ type: "session", sessionID: "ses_abc" })
        dispose()
      })
    })

    test("resets to home route", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.tabs()[0].id
        state.updateRoute(id, { type: "session", sessionID: "ses_abc" })
        state.updateRoute(id, { type: "home" })
        expect(state.tabs()[0].route).toEqual({ type: "home" })
        dispose()
      })
    })

    test("session-to-home replacement removes stale sessionID from route", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.tabs()[0].id
        state.updateRoute(id, { type: "session", sessionID: "ses_abc" })
        expect(state.tabs()[0].route).toEqual({ type: "session", sessionID: "ses_abc" })
        state.updateRoute(id, { type: "home" })
        const route = state.tabs()[0].route as Record<string, unknown>
        expect(route.type).toBe("home")
        expect(route.sessionID).toBeUndefined()
        dispose()
      })
    })

    test("no-op for non-existent tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.updateRoute("nonexistent", { type: "session", sessionID: "ses_abc" })
        expect(state.tabs()[0].route).toEqual({ type: "home" })
        dispose()
      })
    })
  })

  describe("updateSessionID", () => {
    test("sets sessionID on tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.tabs()[0].id
        state.updateSessionID(id, "ses_123")
        expect(state.tabs()[0].sessionID).toBe("ses_123")
        dispose()
      })
    })

    test("overwrites existing sessionID", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.tabs()[0].id
        state.updateSessionID(id, "ses_123")
        state.updateSessionID(id, "ses_456")
        expect(state.tabs()[0].sessionID).toBe("ses_456")
        dispose()
      })
    })
  })

  describe("updateDirectory", () => {
    test("sets directory on tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.tabs()[0].id
        state.updateDirectory(id, "/tmp/project")
        expect(state.tabs()[0].directory).toBe("/tmp/project")
        dispose()
      })
    })

    test("overwrites existing directory", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const id = state.tabs()[0].id
        state.updateDirectory(id, "/tmp/project")
        state.updateDirectory(id, "/tmp/other")
        expect(state.tabs()[0].directory).toBe("/tmp/other")
        dispose()
      })
    })
  })

  // These tests exercise the inline route-to-tab sync logic from app.tsx.
  // The logic mirrors the createEffect in App():
  //   1. Read route type/sessionID (tracked in production)
  //   2. Early return if route matches tab
  //   3. updateRoute
  //   4. updateSessionID (before session lookup — the key fix)
  //   5. session lookup + rename (optional)
  describe("route-to-tab sync logic", () => {
    function syncRoute(
      route: Route,
      tabState: ReturnType<typeof createTabState>,
      findSession?: (id: string) => { displayName?: string; slug: string } | undefined,
    ) {
      const type = route.type
      const sessionID = type === "session" ? route.sessionID : undefined
      const tab = tabState.active()
      if (type === tab.route.type && (tab.route.type !== "session" || sessionID === tab.route.sessionID)) return
      tabState.updateRoute(tab.id, route)
      if (type === "session" && sessionID) {
        if (tab.sessionID !== sessionID) tabState.updateSessionID(tab.id, sessionID)
        const session = findSession?.(sessionID)
        if (session) {
          if (tab.label === "Untitled") tabState.rename(tab.id, session.displayName ?? session.slug)
        }
      }
    }

    test("syncs sessionID even when session not yet in sync store", () => {
      createRoot((dispose) => {
        const state = createTabState()
        syncRoute({ type: "session", sessionID: "ses_new" }, state, () => undefined)
        expect(state.active().sessionID).toBe("ses_new")
        expect(state.active().route).toEqual({ type: "session", sessionID: "ses_new" })
        dispose()
      })
    })

    test("renames tab when session is found", () => {
      createRoot((dispose) => {
        const state = createTabState()
        syncRoute({ type: "session", sessionID: "ses_abc" }, state, () => ({
          displayName: "My Chat",
          slug: "my-chat",
        }))
        expect(state.active().sessionID).toBe("ses_abc")
        expect(state.active().label).toBe("My Chat")
        dispose()
      })
    })

    test("uses slug when displayName is undefined", () => {
      createRoot((dispose) => {
        const state = createTabState()
        syncRoute({ type: "session", sessionID: "ses_abc" }, state, () => ({ slug: "my-chat" }))
        expect(state.active().label).toBe("my-chat")
        dispose()
      })
    })

    test("no-op when route matches tab", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const tabID = state.tabs()[0].id
        state.updateRoute(tabID, { type: "session", sessionID: "ses_abc" })
        state.updateSessionID(tabID, "ses_abc")
        const before = { ...state.active() }
        syncRoute({ type: "session", sessionID: "ses_abc" }, state)
        expect(state.active().sessionID).toBe(before.sessionID)
        expect(state.active().route).toEqual(before.route)
        dispose()
      })
    })

    test("does not rename when label is not Untitled", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.rename(state.tabs()[0].id, "Custom Name")
        syncRoute({ type: "session", sessionID: "ses_abc" }, state, () => ({
          displayName: "My Chat",
          slug: "my-chat",
        }))
        expect(state.active().label).toBe("Custom Name")
        dispose()
      })
    })

    test("does not update sessionID when already matching", () => {
      createRoot((dispose) => {
        const state = createTabState()
        const tabID = state.tabs()[0].id
        state.updateSessionID(tabID, "ses_abc")
        state.updateRoute(tabID, { type: "home" })
        // Route changed to session with same sessionID — route updates but sessionID unchanged
        syncRoute({ type: "session", sessionID: "ses_abc" }, state)
        expect(state.active().sessionID).toBe("ses_abc")
        dispose()
      })
    })
  })

  describe("load", () => {
    test("replaces all state from server data", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.load({
          tabs: [
            { id: "srv_1", sessionID: null, label: "Server Tab", route: { type: "home" } },
            { id: "srv_2", sessionID: "ses_1", label: "Session", route: { type: "session", sessionID: "ses_1" } },
          ],
          activeID: "srv_2",
          previousID: "srv_1",
          position: "top",
        })
        expect(state.tabs()).toHaveLength(2)
        expect(state.active().id).toBe("srv_2")
        expect(state.previousID()).toBe("srv_1")
        expect(state.position()).toBe("top")
        dispose()
      })
    })

    test("syncs nextID to prevent collisions with server tab IDs", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.load({
          tabs: [
            { id: "tab_1", sessionID: null, label: "Tab 1", route: { type: "home" } },
            { id: "tab_2", sessionID: "ses_1", label: "Tab 2", route: { type: "session", sessionID: "ses_1" } },
            { id: "tab_3", sessionID: "ses_2", label: "Tab 3", route: { type: "session", sessionID: "ses_2" } },
          ],
          activeID: "tab_1",
          previousID: null,
          position: "bottom",
        })
        const newID = state.add()
        expect(newID).toBe("tab_4")
        expect(state.tabs().filter((t) => t.id === "tab_2")).toHaveLength(1)
        expect(state.tabs().filter((t) => t.id === "tab_3")).toHaveLength(1)
        dispose()
      })
    })

    test("nextID handles non-tab-prefixed IDs gracefully", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.load({
          tabs: [
            { id: "srv_1", sessionID: null, label: "Server Tab", route: { type: "home" } },
            { id: "tab_5", sessionID: null, label: "Tab 5", route: { type: "home" } },
          ],
          activeID: "srv_1",
          previousID: null,
          position: "bottom",
        })
        const newID = state.add()
        expect(newID).toBe("tab_6")
        dispose()
      })
    })

    test("multiple loads keep nextID in sync", () => {
      createRoot((dispose) => {
        const state = createTabState()
        state.load({
          tabs: [{ id: "tab_3", sessionID: null, label: "Tab", route: { type: "home" } }],
          activeID: "tab_3",
          previousID: null,
          position: "bottom",
        })
        state.load({
          tabs: [
            { id: "tab_3", sessionID: null, label: "Tab", route: { type: "home" } },
            { id: "tab_7", sessionID: null, label: "Tab 7", route: { type: "home" } },
          ],
          activeID: "tab_3",
          previousID: null,
          position: "bottom",
        })
        const newID = state.add()
        expect(newID).toBe("tab_8")
        dispose()
      })
    })
  })
})
