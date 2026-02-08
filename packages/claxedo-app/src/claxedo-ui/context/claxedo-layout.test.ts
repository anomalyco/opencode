/**
 * Split Panel State Isolation Tests
 *
 * Verifies that operations on one split group (tabs, terminals, sessions,
 * badges, agent status, layout) never pollute the other group's state.
 *
 * Strategy: mock persisted + createSimpleContext, capture the init function,
 * and call it inside createRoot to get the real store API.
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { ensureLayoutMocked, getInitLayout } from "./_test-helper"

let initLayout: () => any

beforeAll(async () => {
  await ensureLayoutMocked()
  initLayout = getInitLayout()
})

/** Create a fresh layout store inside a SolidJS root for reactive tracking. */
function createTestLayout() {
  let dispose!: () => void
  const api = createRoot((d) => {
    dispose = d
    return initLayout()
  })
  return { api, dispose }
}

/** Split into two groups and return their IDs + tab accessors. */
function splitInto2(api: any) {
  api.split.toggle()
  const groups = api.split.groups()
  expect(groups).toHaveLength(2)
  const g1 = groups[0].id
  const g2 = groups[1].id
  return {
    g1,
    g2,
    tabs1: api.groupTabs(g1),
    tabs2: api.groupTabs(g2),
  }
}

// ---------------------------------------------------------------------------
// Tab isolation
// ---------------------------------------------------------------------------

describe("tab isolation between groups", () => {
  test("adding session to group A does not appear in group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      tabs1.addSession("/ws", "s1", "Session 1")

      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].sessionId).toBe("s1")
      expect(tabs2.items()).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  test("adding terminal to group A does not appear in group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      tabs1.addTerminal("/ws", "pty-1", "Terminal 1")

      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].terminalId).toBe("pty-1")
      expect(tabs2.items()).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  test("adding review to group A does not appear in group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      tabs1.addReview("/ws", "rev-1", "Review 1", { additions: 5, deletions: 2 })

      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].type).toBe("review")
      expect(tabs2.items()).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  test("adding file tab to group A does not appear in group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      tabs1.addFile("/ws", "/ws/main.ts", "main.ts")

      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].type).toBe("file")
      expect(tabs2.items()).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  test("closing tab in group A does not affect group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const id1 = tabs1.addSession("/ws", "s1", "Session 1")
      const id2 = tabs2.addSession("/ws", "s2", "Session 2")

      tabs1.close(id1)

      expect(tabs1.items()).toHaveLength(0)
      expect(tabs2.items()).toHaveLength(1)
      expect(tabs2.items()[0].id).toBe(id2)
    } finally {
      dispose()
    }
  })

  test("close all tabs in group A leaves group B intact", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const a = tabs1.addSession("/ws", "s1", "S1")
      const b = tabs1.addTerminal("/ws", "pty-1", "T1")
      tabs2.addSession("/ws", "s2", "S2")
      tabs2.addTerminal("/ws", "pty-2", "T2")

      tabs1.close(a)
      tabs1.close(b)

      expect(tabs1.items()).toHaveLength(0)
      expect(tabs2.items()).toHaveLength(2)
    } finally {
      dispose()
    }
  })

  test("reopen last in group A does not affect group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const id = tabs1.addSession("/ws", "s1", "Session 1")
      tabs2.addSession("/ws", "s2", "Session 2")

      tabs1.close(id)
      expect(tabs1.items()).toHaveLength(0)

      tabs1.reopenLast()

      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].sessionId).toBe("s1")
      expect(tabs2.items()).toHaveLength(1)
      expect(tabs2.items()[0].sessionId).toBe("s2")
    } finally {
      dispose()
    }
  })

  test("active tab in group A is independent of group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const a1 = tabs1.addSession("/ws", "s1", "S1")
      const a2 = tabs1.addSession("/ws", "s2", "S2")
      const b1 = tabs2.addSession("/ws", "s3", "S3")

      tabs1.setActive(a1)

      expect(tabs1.activeId()).toBe(a1)
      // Group B active should still be b1 (last added)
      expect(tabs2.activeId()).toBe(b1)

      tabs1.setActive(a2)
      expect(tabs1.activeId()).toBe(a2)
      expect(tabs2.activeId()).toBe(b1)
    } finally {
      dispose()
    }
  })

  test("tab ordering in group A is independent of group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const a1 = tabs1.addSession("/ws", "s1", "S1")
      const a2 = tabs1.addSession("/ws", "s2", "S2")
      const b1 = tabs2.addSession("/ws", "s3", "S3")
      const b2 = tabs2.addSession("/ws", "s4", "S4")

      // Reorder group A
      tabs1.move(a1, 1)

      const orderedA = tabs1.orderedItems().map((t: any) => t.id)
      const orderedB = tabs2.orderedItems().map((t: any) => t.id)

      expect(orderedA).toEqual([a2, a1])
      expect(orderedB).toEqual([b1, b2])
    } finally {
      dispose()
    }
  })

  test("addSession deduplicates within same group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      const id1 = tabs1.addSession("/ws", "s1", "Session 1")
      const id2 = tabs1.addSession("/ws", "s1", "Session 1 Updated")

      expect(id1).toBe(id2)
      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].title).toBe("Session 1 Updated")
    } finally {
      dispose()
    }
  })

  test("same session in different groups gets independent tabs", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const id1 = tabs1.addSession("/ws", "shared-session", "Session")
      const id2 = tabs2.addSession("/ws", "shared-session", "Session")

      expect(id1).not.toBe(id2)
      expect(tabs1.items()).toHaveLength(1)
      expect(tabs2.items()).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  test("badge update in group A does not affect same session in group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const id1 = tabs1.addSession("/ws", "shared", "S")
      const id2 = tabs2.addSession("/ws", "shared", "S")

      tabs1.updateBadge(id1, { additions: 10, deletions: 3 })

      expect(tabs1.items()[0].badge).toEqual({ additions: 10, deletions: 3 })
      expect(tabs2.items()[0].badge).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("title update in group A does not affect same session in group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const id1 = tabs1.addSession("/ws", "shared", "Original")
      tabs2.addSession("/ws", "shared", "Original")

      tabs1.updateTitle(id1, "Updated Title")

      expect(tabs1.items()[0].title).toBe("Updated Title")
      expect(tabs2.items()[0].title).toBe("Original")
    } finally {
      dispose()
    }
  })

  test("patch in group A does not affect group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const id1 = tabs1.addTerminal("/ws", "pty-1", "Terminal 1")
      tabs2.addTerminal("/ws", "pty-1", "Terminal 1")

      tabs1.patch(id1, { attention: true, loading: true })

      expect(tabs1.items()[0].attention).toBe(true)
      expect(tabs1.items()[0].loading).toBe(true)
      expect(tabs2.items()[0].attention).toBeUndefined()
      expect(tabs2.items()[0].loading).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// topTabs delegation
// ---------------------------------------------------------------------------

describe("topTabs delegates to focused group", () => {
  test("topTabs reads from focused group only", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      tabs1.addSession("/ws", "s1", "In Group 1")
      tabs2.addSession("/ws", "s2", "In Group 2")

      api.split.setFocus(g1)
      expect(api.topTabs.items()).toHaveLength(1)
      expect(api.topTabs.items()[0].sessionId).toBe("s1")

      api.split.setFocus(g2)
      expect(api.topTabs.items()).toHaveLength(1)
      expect(api.topTabs.items()[0].sessionId).toBe("s2")
    } finally {
      dispose()
    }
  })

  test("topTabs writes go to focused group only", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1, tabs2 } = splitInto2(api)

      api.split.setFocus(g1)
      api.topTabs.addSession("/ws", "top-session", "TopTab Session")

      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].sessionId).toBe("top-session")
      expect(tabs2.items()).toHaveLength(0)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// findTabGroup
// ---------------------------------------------------------------------------

describe("findTabGroup", () => {
  test("identifies which group a tab belongs to", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      const id1 = tabs1.addSession("/ws", "s1", "S1")
      const id2 = tabs2.addSession("/ws", "s2", "S2")

      expect(api.findTabGroup(id1)).toBe(g1)
      expect(api.findTabGroup(id2)).toBe(g2)
    } finally {
      dispose()
    }
  })

  test("returns undefined for nonexistent tab", () => {
    const { api, dispose } = createTestLayout()
    try {
      splitInto2(api)
      expect(api.findTabGroup("nonexistent")).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// patchTab (cross-group)
// ---------------------------------------------------------------------------

describe("patchTab", () => {
  test("patches tab in any group by ID", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const id1 = tabs1.addSession("/ws", "s1", "S1")
      const id2 = tabs2.addSession("/ws", "s2", "S2")

      // patchTab targets by ID across all groups
      api.patchTab(id2, { title: "Patched" })

      expect(tabs1.items()[0].title).toBe("S1")
      expect(tabs2.items()[0].title).toBe("Patched")
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Terminal creation coordination
// ---------------------------------------------------------------------------

describe("terminal creation coordination", () => {
  test("requestCreate sets pendingGroupId to requested group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)

      api.terminal.requestCreate("/ws", undefined, undefined, g1)

      expect(api.terminal.pendingGroupId()).toBe(g1)
      expect(api.terminal.pendingDir()).toBe("/ws")
      expect(api.terminal.creating()).toBe(1)
      expect(api.terminal.creatingGroupId()).toBe(g1)
    } finally {
      dispose()
    }
  })

  test("creatingGroupId only targets requested group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)

      api.terminal.requestCreate("/ws", undefined, undefined, g1)

      expect(api.terminal.creatingGroupId()).toBe(g1)
      expect(api.terminal.creatingGroupId()).not.toBe(g2)
    } finally {
      dispose()
    }
  })

  test("consumePendingCommand returns correct groupId and clears", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g2 } = splitInto2(api)

      api.terminal.requestCreate("/ws", "ls -la", "Agent", g2)

      const consumed = api.terminal.consumePendingCommand()

      expect(consumed.groupId).toBe(g2)
      expect(consumed.command).toBe("ls -la")
      expect(consumed.title).toBe("Agent")
      expect(consumed.directory).toBe("/ws")

      // Should be cleared after consumption
      expect(api.terminal.pendingGroupId()).toBeUndefined()
      expect(api.terminal.pendingCommand()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("created() clears creatingGroupId when counter reaches 0", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)

      api.terminal.requestCreate("/ws", undefined, undefined, g1)
      expect(api.terminal.creating()).toBe(1)
      expect(api.terminal.creatingGroupId()).toBe(g1)

      api.terminal.created()

      expect(api.terminal.creating()).toBe(0)
      expect(api.terminal.creatingGroupId()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("multiple creates: creatingGroupId cleared only at 0", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)

      api.terminal.requestCreate("/ws", undefined, undefined, g1)
      api.terminal.requestCreate("/ws", undefined, undefined, g2)

      expect(api.terminal.creating()).toBe(2)
      // Note: creatingGroupId is set to the LAST requestCreate's group
      expect(api.terminal.creatingGroupId()).toBe(g2)

      api.terminal.created()
      expect(api.terminal.creating()).toBe(1)
      // Not yet 0, so groupId is still set
      expect(api.terminal.creatingGroupId()).toBe(g2)

      api.terminal.created()
      expect(api.terminal.creating()).toBe(0)
      expect(api.terminal.creatingGroupId()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("clearPendingCreate resets all pending state", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)

      api.terminal.requestCreate("/ws", "echo hi", "Agent", g1)
      api.terminal.clearPendingCreate()

      expect(api.terminal.pendingCreate()).toBe(0)
      expect(api.terminal.pendingCommand()).toBeUndefined()
      expect(api.terminal.pendingDir()).toBeUndefined()
      expect(api.terminal.pendingGroupId()).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Terminal pane isolation
// ---------------------------------------------------------------------------

describe("terminal pane isolation", () => {
  test("terminal ensure in tab A does not affect tab B", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")

      expect(api.terminal.pane("tab-a")).toBeDefined()
      expect(api.terminal.ids("tab-a")).toEqual(["pty-1"])
      expect(api.terminal.pane("tab-b")).toBeUndefined()
      expect(api.terminal.ids("tab-b")).toEqual([])
    } finally {
      dispose()
    }
  })

  test("terminal split in tab A does not affect tab B", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.ensure("tab-b", "pty-2")

      api.terminal.split({ tab: "tab-a", at: "pty-1", id: "pty-3", dir: "v" })

      expect(api.terminal.ids("tab-a")).toEqual(["pty-1", "pty-3"])
      expect(api.terminal.ids("tab-b")).toEqual(["pty-2"])
    } finally {
      dispose()
    }
  })

  test("terminal close in tab A does not affect tab B", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.ensure("tab-b", "pty-2")
      api.terminal.split({ tab: "tab-a", at: "pty-1", id: "pty-3", dir: "v" })

      api.terminal.close({ tab: "tab-a", id: "pty-3" })

      expect(api.terminal.ids("tab-a")).toEqual(["pty-1"])
      expect(api.terminal.ids("tab-b")).toEqual(["pty-2"])
    } finally {
      dispose()
    }
  })

  test("terminal focus is per-tab", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.ensure("tab-b", "pty-2")

      api.terminal.setFocus("tab-a", "pty-1")
      api.terminal.setFocus("tab-b", "pty-2")

      expect(api.terminal.focus("tab-a")).toBe("pty-1")
      expect(api.terminal.focus("tab-b")).toBe("pty-2")

      api.terminal.setFocus("tab-a", "pty-999")

      expect(api.terminal.focus("tab-a")).toBe("pty-999")
      expect(api.terminal.focus("tab-b")).toBe("pty-2")
    } finally {
      dispose()
    }
  })

  test("terminal zoom is per-tab", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.ensure("tab-b", "pty-2")

      api.terminal.setZoom("tab-a", "pty-1")

      expect(api.terminal.zoom("tab-a")).toBe("pty-1")
      expect(api.terminal.zoom("tab-b")).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("terminal owner is per-terminal-id", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.own("tab-a", "pty-1")
      api.terminal.own("tab-b", "pty-2")

      expect(api.terminal.owner("pty-1")).toBe("tab-a")
      expect(api.terminal.owner("pty-2")).toBe("tab-b")
      expect(api.terminal.owner("pty-3")).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("terminal disown removes only target", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.own("tab-a", "pty-1")
      api.terminal.own("tab-b", "pty-2")

      api.terminal.disown("pty-1")

      expect(api.terminal.owner("pty-1")).toBeUndefined()
      expect(api.terminal.owner("pty-2")).toBe("tab-b")
    } finally {
      dispose()
    }
  })

  test("terminal clear removes only state for that tab", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.ensure("tab-b", "pty-2")
      api.terminal.own("tab-a", "pty-1")
      api.terminal.own("tab-b", "pty-2")
      api.terminal.setAgentStatus("pty-1", "working")
      api.terminal.setAgentStatus("pty-2", "working")

      api.terminal.clear("tab-a")

      expect(api.terminal.pane("tab-a")).toBeUndefined()
      expect(api.terminal.focus("tab-a")).toBeUndefined()
      expect(api.terminal.zoom("tab-a")).toBeUndefined()
      expect(api.terminal.owner("pty-1")).toBeUndefined()
      expect(api.terminal.agentStatus("pty-1")).toBe("idle")

      // tab-b should be completely unaffected
      expect(api.terminal.pane("tab-b")).toBeDefined()
      expect(api.terminal.ids("tab-b")).toEqual(["pty-2"])
      expect(api.terminal.owner("pty-2")).toBe("tab-b")
      expect(api.terminal.agentStatus("pty-2")).toBe("working")
    } finally {
      dispose()
    }
  })

  test("closing a terminal tab clears pane and owner state", () => {
    const { api, dispose } = createTestLayout()
    try {
      const tabId = api.topTabs.addTerminal("/ws", "pty-1", "Terminal 1")
      expect(tabId).toBeTruthy()
      if (!tabId) return

      api.terminal.ensure(tabId, "pty-1")
      api.terminal.own(tabId, "pty-1")
      api.terminal.setFocus(tabId, "pty-1")
      api.terminal.setZoom(tabId, "pty-1")

      expect(api.terminal.pane(tabId)).toBeDefined()
      expect(api.terminal.owner("pty-1")).toBe(tabId)

      api.topTabs.close(tabId)

      expect(api.terminal.pane(tabId)).toBeUndefined()
      expect(api.terminal.focus(tabId)).toBeUndefined()
      expect(api.terminal.zoom(tabId)).toBeUndefined()
      expect(api.terminal.owner("pty-1")).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("closing terminal tab clears agent state even when owner link is missing", () => {
    const { api, dispose } = createTestLayout()
    try {
      const tabId = api.topTabs.addTerminal("/ws", "pty-1", "Terminal 1")
      expect(tabId).toBeTruthy()
      if (!tabId) return

      // Simulate race: pane exists but owner mapping was never written.
      api.terminal.ensure(tabId, "pty-1")
      api.terminal.setAgentStatus("pty-1", "working")

      expect(api.terminal.agentStatus("pty-1")).toBe("working")
      expect(api.terminal.owner("pty-1")).toBeUndefined()

      api.topTabs.close(tabId)

      expect(api.terminal.pane(tabId)).toBeUndefined()
      expect(api.terminal.agentStatus("pty-1")).toBe("idle")
    } finally {
      dispose()
    }
  })

  test("terminal resize in tab A does not affect tab B", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.split({ tab: "tab-a", at: "pty-1", id: "pty-2", dir: "v" })
      api.terminal.ensure("tab-b", "pty-3")
      api.terminal.split({ tab: "tab-b", at: "pty-3", id: "pty-4", dir: "v" })

      api.terminal.resize({ tab: "tab-a", path: "", size: 0.3 })

      const paneA = api.terminal.pane("tab-a") as { size: number }
      const paneB = api.terminal.pane("tab-b") as { size: number }

      expect(paneA.size).toBeCloseTo(0.3)
      expect(paneB.size).toBeCloseTo(0.5) // default
    } finally {
      dispose()
    }
  })

  test("terminal swap in tab A does not affect tab B", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.split({ tab: "tab-a", at: "pty-1", id: "pty-2", dir: "v" })
      api.terminal.ensure("tab-b", "pty-3")
      api.terminal.split({ tab: "tab-b", at: "pty-3", id: "pty-4", dir: "v" })

      api.terminal.swap({ tab: "tab-a", a: "pty-1", b: "pty-2" })

      // tab-a panes swapped
      const idsA = api.terminal.ids("tab-a")
      expect(idsA).toEqual(["pty-2", "pty-1"])

      // tab-b untouched
      const idsB = api.terminal.ids("tab-b")
      expect(idsB).toEqual(["pty-3", "pty-4"])
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Agent status isolation
// ---------------------------------------------------------------------------

describe("agent status isolation", () => {
  test("agent status is per terminal", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.setAgentStatus("pty-1", "working")
      api.terminal.setAgentStatus("pty-2", "permission")

      expect(api.terminal.agentStatus("pty-1")).toBe("working")
      expect(api.terminal.agentStatus("pty-2")).toBe("permission")
      expect(api.terminal.agentStatus("pty-3")).toBe("idle")
    } finally {
      dispose()
    }
  })

  test("clearAgentStatus only clears target terminal", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.setAgentStatus("pty-1", "working")
      api.terminal.setAgentStatus("pty-2", "permission")

      api.terminal.clearAgentStatus("pty-1")

      expect(api.terminal.agentStatus("pty-1")).toBe("idle")
      expect(api.terminal.agentStatus("pty-2")).toBe("permission")
    } finally {
      dispose()
    }
  })

  test("clearSeen only clears target terminal", () => {
    const { api, dispose } = createTestLayout()
    try {
      // setAgentStatus with non-idle marks the terminal as "seen"
      api.terminal.setAgentStatus("pty-1", "working")
      api.terminal.setAgentStatus("pty-2", "working")

      api.terminal.clearSeen("pty-1")

      // After clearSeen + idle, "done" should be false for pty-1
      api.terminal.setAgentStatus("pty-1", "idle")
      api.terminal.setAgentStatus("pty-2", "idle")

      // pty-1 was cleared before going idle -> not "done"
      // pty-2 was seen, went idle -> "done"
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.ensure("tab-b", "pty-2")

      const statusA = api.terminal.getTabAgentStatus("tab-a")
      const statusB = api.terminal.getTabAgentStatus("tab-b")

      expect(statusA.done).toBe(false)
      expect(statusB.done).toBe(true)
    } finally {
      dispose()
    }
  })

  test("tab agent status aggregates correctly within its tab only", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Tab A has two terminals: one working, one idle
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.split({ tab: "tab-a", at: "pty-1", id: "pty-2", dir: "v" })

      // Tab B has one terminal: permission
      api.terminal.ensure("tab-b", "pty-3")

      api.terminal.setAgentStatus("pty-1", "working")
      api.terminal.setAgentStatus("pty-3", "permission")

      const statusA = api.terminal.getTabAgentStatus("tab-a")
      const statusB = api.terminal.getTabAgentStatus("tab-b")

      expect(statusA.loading).toBe(true)
      expect(statusA.attention).toBe(false)

      expect(statusB.loading).toBe(false)
      expect(statusB.attention).toBe(true)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Worktree isolation
// ---------------------------------------------------------------------------

describe("worktree isolation between groups", () => {
  test("setDefault in group A does not affect group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)
      const wt2 = api.groupWorktree(g2)

      wt1.setDefault("/workspace-a")

      expect(wt1.default()).toBe("/workspace-a")
      expect(wt2.default()).toBeNull()
    } finally {
      dispose()
    }
  })

  test("setPinned in group A does not affect group B", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)
      const wt2 = api.groupWorktree(g2)

      wt1.setPinned("/pinned-a")

      expect(wt1.pinned()).toBe("/pinned-a")
      expect(wt2.pinned()).toBeNull()
    } finally {
      dispose()
    }
  })

  test("worktree alias delegates to focused group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)
      const wt2 = api.groupWorktree(g2)

      wt1.setDefault("/ws-a")
      wt2.setDefault("/ws-b")

      api.split.setFocus(g1)
      expect(api.worktree.default()).toBe("/ws-a")

      api.split.setFocus(g2)
      expect(api.worktree.default()).toBe("/ws-b")
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Layout isolation (file tree, session panel, review panel)
// ---------------------------------------------------------------------------

describe("layout isolation between groups", () => {
  test("file tree state per group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const layout1 = api.groupLayout(g1)
      const layout2 = api.groupLayout(g2)

      layout1.fileTree.setOpened(false)
      layout1.fileTree.setWidth(200)
      layout1.fileTree.setTab("all")

      expect(layout1.fileTree.opened()).toBe(false)
      expect(layout1.fileTree.width()).toBe(200)
      expect(layout1.fileTree.tab()).toBe("all")

      // Group B defaults untouched
      expect(layout2.fileTree.opened()).toBe(true)
      expect(layout2.fileTree.width()).toBe(344)
      expect(layout2.fileTree.tab()).toBe("changes")
    } finally {
      dispose()
    }
  })

  test("session panel state per group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const layout1 = api.groupLayout(g1)
      const layout2 = api.groupLayout(g2)

      layout1.session.setCollapsed(true)
      layout1.session.setWidth(300)
      layout1.session.setPanelMode(2)

      expect(layout1.session.collapsed()).toBe(true)
      expect(layout1.session.width()).toBe(300)
      expect(layout1.session.panelMode()).toBe(2)

      // Group B defaults untouched
      expect(layout2.session.collapsed()).toBe(false)
      expect(layout2.session.width()).toBe(600)
      expect(layout2.session.panelMode()).toBe(0)
    } finally {
      dispose()
    }
  })

  test("review panel state per group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const layout1 = api.groupLayout(g1)
      const layout2 = api.groupLayout(g2)

      // Both default to false
      expect(layout1.reviewPanel.opened()).toBe(false)
      expect(layout2.reviewPanel.opened()).toBe(false)

      // Open in group 1 only
      layout1.reviewPanel.setOpened(true)

      expect(layout1.reviewPanel.opened()).toBe(true)
      expect(layout2.reviewPanel.opened()).toBe(false)

      // Open in group 2, close in group 1
      layout2.reviewPanel.setOpened(true)
      layout1.reviewPanel.setOpened(false)

      expect(layout1.reviewPanel.opened()).toBe(false)
      expect(layout2.reviewPanel.opened()).toBe(true)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Split operations
// ---------------------------------------------------------------------------

describe("split operations", () => {
  test("toggle creates second group with empty tabs", () => {
    const { api, dispose } = createTestLayout()
    try {
      expect(api.split.groups()).toHaveLength(1)

      api.split.toggle()

      expect(api.split.groups()).toHaveLength(2)
      expect(api.split.sizes()).toEqual([0.5, 0.5])

      const g2 = api.split.groups()[1]
      expect(api.groupTabs(g2.id).items()).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  test("toggle hides split (groups preserved, only primary visible)", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const tabs1 = api.groupTabs(groups[0].id)
      const tabs2 = api.groupTabs(groups[1].id)

      tabs1.addSession("/ws", "s1", "Session 1")
      tabs2.addSession("/ws", "s2", "Session 2")
      tabs2.addTerminal("/ws", "pty-1", "Terminal 1")

      // Toggle hides — groups still exist, split.active is false
      api.split.toggle()

      expect(api.split.groups()).toHaveLength(2)
      expect(api.split.active()).toBe(false)
      expect(api.split.hidden()).toBe(true)

      // Tabs are preserved in both groups
      expect(tabs1.items()).toHaveLength(1)
      expect(tabs2.items()).toHaveLength(2)

      // Toggle again shows
      api.split.toggle()
      expect(api.split.active()).toBe(true)
      expect(api.split.hidden()).toBe(false)
    } finally {
      dispose()
    }
  })

  test("toggle hide preserves focused group", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g2 = groups[1].id
      api.split.setFocus(g2)
      expect(api.split.focusedId()).toBe(g2)

      api.split.toggle()
      expect(api.split.hidden()).toBe(true)
      expect(api.split.focusedId()).toBe(g2)
    } finally {
      dispose()
    }
  })

  test("closeGroup merges non-terminal tabs into first group and drops closed-group terminals", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g2Id = groups[1].id
      const tabs1 = api.groupTabs(groups[0].id)
      const tabs2 = api.groupTabs(g2Id)

      tabs1.addSession("/ws", "s1", "Session 1")
      tabs2.addSession("/ws", "s2", "Session 2")
      tabs2.addTerminal("/ws", "pty-1", "Terminal 1")

      // Close group 2 — merge keeps non-terminals, terminals are disposed.
      api.split.closeGroup(g2Id)

      expect(api.split.groups()).toHaveLength(1)
      const merged = api.groupTabs(api.split.groups()[0].id)
      const sessions = merged.items().filter((t: any) => t.type === "session")
      const terminals = merged.items().filter((t: any) => t.type === "terminal")

      expect(sessions).toHaveLength(2)
      expect(terminals).toHaveLength(0)
    } finally {
      dispose()
    }
  })

  test("closeGroup assigns active tab when primary group was empty", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const [g1, g2] = api.split.groups().map((g: any) => g.id)
      const tabs1 = api.groupTabs(g1)
      const tabs2 = api.groupTabs(g2)

      const right = tabs2.addSession("/ws", "s-right", "Right session")
      expect(right).toBeTruthy()
      if (!right) return

      // Primary group starts empty; after merge it must receive an active tab.
      expect(tabs1.items()).toHaveLength(0)
      expect(tabs1.activeId()).toBeNull()

      api.split.closeGroup(g2)

      const primary = api.groupTabs(g1)
      expect(primary.items()).toHaveLength(1)
      expect(primary.items()[0]?.sessionId).toBe("s-right")
      expect(primary.activeId()).toBe(primary.items()[0]?.id)
      expect(primary.active()).toBeDefined()
    } finally {
      dispose()
    }
  })

  test("closeGroup does not move terminal tabs from closed group into primary", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)
      const left = tabs1.addTerminal("/ws", "pty-left", "Left")
      const right = tabs2.addTerminal("/ws", "pty-right", "Right")
      expect(left).toBeTruthy()
      expect(right).toBeTruthy()
      if (!left || !right) return

      api.split.closeGroup(g2)

      const remaining = api.groupTabs(g1)
      expect(remaining.items().some((t: any) => t.terminalId === "pty-left")).toBe(true)
      expect(remaining.items().some((t: any) => t.terminalId === "pty-right")).toBe(false)
    } finally {
      dispose()
    }
  })

  test("moveTab transfers tab from source to destination group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      const id = tabs1.addSession("/ws", "s1", "Session 1")
      tabs1.addTerminal("/ws", "pty-1", "Terminal 1")

      expect(tabs1.items()).toHaveLength(2)
      expect(tabs2.items()).toHaveLength(0)

      api.split.moveTab(id, g1, g2)

      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].type).toBe("terminal")
      expect(tabs2.items()).toHaveLength(1)
      expect(tabs2.items()[0].sessionId).toBe("s1")
    } finally {
      dispose()
    }
  })

  test("moveTab to 'new' removes tab from source group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      // Add tabs to both groups so neither gets auto-removed
      const id = tabs1.addSession("/ws", "s1", "Session 1")
      tabs1.addTerminal("/ws", "pty-1", "Terminal 1")
      tabs2.addSession("/ws", "s2", "Session 2")

      api.split.moveTab(id, g1, g2)

      // g1 retains the terminal, g2 now has both sessions
      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].type).toBe("terminal")
      expect(tabs2.items()).toHaveLength(2)
      expect(tabs2.items().some((t: any) => t.sessionId === "s1")).toBe(true)
      expect(tabs2.items().some((t: any) => t.sessionId === "s2")).toBe(true)
    } finally {
      dispose()
    }
  })

  test("setFocus changes focused group without mutating tabs", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      tabs1.addSession("/ws", "s1", "S1")
      tabs2.addSession("/ws", "s2", "S2")

      expect(api.split.focusedId()).toBe(g1)

      api.split.setFocus(g2)

      expect(api.split.focusedId()).toBe(g2)
      // Tabs unchanged
      expect(tabs1.items()).toHaveLength(1)
      expect(tabs2.items()).toHaveLength(1)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// End-to-end scenarios
// ---------------------------------------------------------------------------

describe("end-to-end split panel scenarios", () => {
  test("full workflow: create sessions and terminals in both groups independently", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      // Group 1: session + terminal
      const s1 = tabs1.addSession("/ws-a", "session-a", "Session A")
      const t1 = tabs1.addTerminal("/ws-a", "pty-a", "Terminal A")

      // Group 2: different session + terminal
      const s2 = tabs2.addSession("/ws-b", "session-b", "Session B")
      const t2 = tabs2.addTerminal("/ws-b", "pty-b", "Terminal B")

      // Verify complete isolation
      expect(tabs1.items()).toHaveLength(2)
      expect(tabs2.items()).toHaveLength(2)
      expect(tabs1.items().map((t: any) => t.id).sort()).toEqual([s1, t1].sort())
      expect(tabs2.items().map((t: any) => t.id).sort()).toEqual([s2, t2].sort())

      // Close terminal in group 1 — group 2 unaffected
      tabs1.close(t1)
      expect(tabs1.items()).toHaveLength(1)
      expect(tabs1.items()[0].id).toBe(s1)
      expect(tabs2.items()).toHaveLength(2)

      // Badge update in group 2 — group 1 unaffected
      tabs2.updateBadge(s2, { additions: 5, deletions: 1 })
      expect(tabs1.items()[0].badge).toBeUndefined()
      expect(tabs2.items().find((t: any) => t.id === s2)?.badge).toEqual({ additions: 5, deletions: 1 })

      // Active tab switching — independent
      tabs1.setActive(s1)
      tabs2.setActive(t2)
      expect(tabs1.activeId()).toBe(s1)
      expect(tabs2.activeId()).toBe(t2)
    } finally {
      dispose()
    }
  })

  test("terminal creation request targets correct group, does not leak", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)

      // Request terminal creation for group 2
      api.terminal.requestCreate("/ws", "npm start", "Agent", g2)

      // Verify targeting
      expect(api.terminal.creating()).toBe(1)
      expect(api.terminal.creatingGroupId()).toBe(g2)
      expect(api.terminal.pendingGroupId()).toBe(g2)

      // Consume
      const { groupId, command, title } = api.terminal.consumePendingCommand()
      expect(groupId).toBe(g2)
      expect(command).toBe("npm start")
      expect(title).toBe("Agent")

      // Complete
      api.terminal.created()
      expect(api.terminal.creating()).toBe(0)
      expect(api.terminal.creatingGroupId()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("same terminal ID in panes of different tabs stays isolated", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Two tabs referencing the same PTY ID in their panes
      // (shouldn't happen in practice, but tests isolation)
      api.terminal.ensure("tab-a", "pty-shared")
      api.terminal.ensure("tab-b", "pty-shared")

      api.terminal.split({ tab: "tab-a", at: "pty-shared", id: "pty-extra", dir: "v" })

      // tab-a has split, tab-b still has single leaf
      expect(api.terminal.ids("tab-a")).toEqual(["pty-shared", "pty-extra"])
      expect(api.terminal.ids("tab-b")).toEqual(["pty-shared"])

      // Closing from tab-a doesn't affect tab-b
      api.terminal.close({ tab: "tab-a", id: "pty-extra" })
      expect(api.terminal.ids("tab-a")).toEqual(["pty-shared"])
      expect(api.terminal.ids("tab-b")).toEqual(["pty-shared"])
    } finally {
      dispose()
    }
  })

  test("notification badges: attention/done flags isolated per tab", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const t1 = tabs1.addTerminal("/ws", "pty-1", "Terminal 1")
      const t2 = tabs2.addTerminal("/ws", "pty-2", "Terminal 2")

      // Set attention on group 1's terminal tab
      tabs1.patch(t1, { attention: true })

      expect(tabs1.items()[0].attention).toBe(true)
      expect(tabs2.items()[0].attention).toBeUndefined()

      // Set done indicator on group 2's terminal tab
      tabs2.patch(t2, { done: true })

      expect(tabs1.items()[0].done).toBeUndefined()
      expect(tabs2.items()[0].done).toBe(true)
    } finally {
      dispose()
    }
  })

  test("loading indicator isolated per tab", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1, tabs2 } = splitInto2(api)

      const t1 = tabs1.addSession("/ws", "s1", "Session 1")
      tabs2.addSession("/ws", "s2", "Session 2")

      tabs1.patch(t1, { loading: true })

      expect(tabs1.items()[0].loading).toBe(true)
      expect(tabs2.items()[0].loading).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Bug regression: split toggle merge and state cleanup
// ---------------------------------------------------------------------------

describe("bug: closeGroup merge deduplicates tabs", () => {
  test("closeGroup deduplicates session tabs with same sessionId and directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      // Same session open in both groups (common when user splits with a session active)
      tabs1.addSession("/ws", "shared-session", "Session 1")
      tabs2.addSession("/ws", "shared-session", "Session 1")

      expect(tabs1.items()).toHaveLength(1)
      expect(tabs2.items()).toHaveLength(1)

      // Close group 2 → merge into group 1
      api.split.closeGroup(g2)

      // Should have exactly 1 session tab (deduped), not 2
      const remaining = api.groupTabs(api.split.groups()[0].id)
      expect(remaining.items()).toHaveLength(1)
      expect(remaining.items()[0].sessionId).toBe("shared-session")
    } finally {
      dispose()
    }
  })

  test("closeGroup keeps distinct sessions even with same sessionId in different directories", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      // Same sessionId but different directories → keep both
      tabs1.addSession("/ws-a", "s1", "Session 1")
      tabs2.addSession("/ws-b", "s1", "Session 1")

      api.split.closeGroup(g2)

      const remaining = api.groupTabs(api.split.groups()[0].id)
      expect(remaining.items()).toHaveLength(2)
    } finally {
      dispose()
    }
  })

  test("closeGroup deduplicates terminal tabs with same terminalId", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      // Same terminal tab in both groups
      tabs1.addTerminal("/ws", "pty-1", "Terminal 1")
      tabs2.addTerminal("/ws", "pty-1", "Terminal 1")

      api.split.closeGroup(g2)

      const remaining = api.groupTabs(api.split.groups()[0].id)
      const terminalTabs = remaining.items().filter((t: any) => t.type === "terminal" && t.terminalId === "pty-1")
      expect(terminalTabs).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  test("closeGroup dedupe drops duplicate terminal tab and clears its pane state", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      const keep = tabs1.addTerminal("/ws", "pty-1", "Claude 1")
      const drop = tabs2.addTerminal("/ws", "pty-1", "Claude 1")

      api.terminal.ensure(keep, "pty-1")
      api.terminal.ensure(drop, "pty-1")
      api.terminal.setFocus(drop, "pty-1")
      api.terminal.setZoom(drop, "pty-1")

      expect(api.terminal.pane(drop)).toBeDefined()
      expect(api.terminal.focus(drop)).toBe("pty-1")
      expect(api.terminal.zoom(drop)).toBe("pty-1")

      api.split.closeGroup(g2)

      expect(api.split.groups()).toHaveLength(1)
      const remaining = api.groupTabs(g1).items()
      expect(remaining.some((t: any) => t.id === keep)).toBe(true)
      expect(remaining.some((t: any) => t.id === drop)).toBe(false)

      expect(api.terminal.pane(drop)).toBeUndefined()
      expect(api.terminal.focus(drop)).toBeUndefined()
      expect(api.terminal.zoom(drop)).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

describe("bug: closeGroup clears stale creating state for removed groups", () => {
  test("closeGroup clears creating counter and groupId when removing group with pending create", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)

      // Simulate unhandled requestCreate targeting g2 (no TerminalContentWrapperInner for g2)
      api.terminal.requestCreate("/ws", undefined, undefined, g2)

      expect(api.terminal.creating()).toBe(1)
      expect(api.terminal.creatingGroupId()).toBe(g2)

      // Close group 2 explicitly
      api.split.closeGroup(g2)

      // Creating state for removed group should be cleared
      expect(api.terminal.creating()).toBe(0)
      expect(api.terminal.creatingGroupId()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("after closeGroup, new requestCreate works without stale creating counter", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)

      // Unhandled requestCreate targeting g2
      api.terminal.requestCreate("/ws", undefined, undefined, g2)
      expect(api.terminal.creating()).toBe(1)

      // Close group 2
      api.split.closeGroup(g2)

      // New requestCreate for remaining group
      const remainingId = api.split.groups()[0].id
      api.terminal.requestCreate("/ws", undefined, undefined, remainingId)

      // Simulate terminal created
      api.terminal.created()

      // Should be 0 — not stuck at 1 from old unhandled create
      expect(api.terminal.creating()).toBe(0)
      expect(api.terminal.creatingGroupId()).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

describe("bug: tab operations work after closing split", () => {
  test("close all tabs in right panel, closeGroup, then create/close tabs in remaining panel", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      // Add sessions to both groups
      tabs1.addSession("/ws", "s1", "Session 1")
      const temp = tabs2.addSession("/ws", "temp", "Temp Session")

      // Close all tabs in right panel
      tabs2.close(temp)
      expect(tabs2.items()).toHaveLength(0)

      // Close group 2 explicitly
      api.split.closeGroup(g2)

      // Remaining group should have 1 tab
      const remainingId = api.split.groups()[0].id
      const remaining = api.groupTabs(remainingId)
      expect(remaining.items()).toHaveLength(1)

      // Create new tab — should work
      const newId = remaining.addSession("/ws", "s2", "Session 2")
      expect(newId).toBeTruthy()
      expect(remaining.items()).toHaveLength(2)

      // Close the new tab — should work
      remaining.close(newId!)
      expect(remaining.items()).toHaveLength(1)
      expect(remaining.items()[0].sessionId).toBe("s1")
    } finally {
      dispose()
    }
  })

  test("toggle hide then toggle show preserves all state", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      tabs1.addSession("/ws", "s1", "Session 1")
      tabs2.addSession("/ws", "s2", "Session 2")
      tabs2.addTerminal("/ws", "pty-1", "Terminal 1")

      // Hide split
      api.split.toggle()
      expect(api.split.hidden()).toBe(true)
      expect(api.split.active()).toBe(false)
      expect(api.split.focusedId()).toBe(g1)

      // All tabs still exist
      expect(tabs1.items()).toHaveLength(1)
      expect(tabs2.items()).toHaveLength(2)

      // Show split
      api.split.toggle()
      expect(api.split.hidden()).toBe(false)
      expect(api.split.active()).toBe(true)

      // Everything preserved
      expect(tabs1.items()).toHaveLength(1)
      expect(tabs2.items()).toHaveLength(2)
    } finally {
      dispose()
    }
  })
})
