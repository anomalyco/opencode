import { describe, expect, test, beforeEach } from "bun:test"
import { createRoot } from "solid-js"
import { createTabState, resetTabID } from "../../../../src/cli/cmd/tui/context/tab-state"

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

    test("activate same tab is no-op for history", () => {
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
  })
})
