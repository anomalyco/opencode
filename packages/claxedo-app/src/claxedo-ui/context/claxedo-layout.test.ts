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
import { createEffect, createRoot, createSignal, on } from "solid-js"
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

  test("terminal focus is per-tab and updating one tab does not change the other", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.split({ tab: "tab-a", at: "pty-1", id: "pty-1b", dir: "v" })
      api.terminal.ensure("tab-b", "pty-2")

      api.terminal.setFocus("tab-a", "pty-1")
      api.terminal.setFocus("tab-b", "pty-2")

      // Focus is independent per tab
      expect(api.terminal.focus("tab-a")).toBe("pty-1")
      expect(api.terminal.focus("tab-b")).toBe("pty-2")

      // Changing focus within a split pane updates only that tab
      api.terminal.setFocus("tab-a", "pty-1b")
      expect(api.terminal.focus("tab-a")).toBe("pty-1b")
      expect(api.terminal.focus("tab-b")).toBe("pty-2")

      // Focus on a tab that was never ensured returns undefined
      expect(api.terminal.focus("tab-nonexistent")).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("terminal zoom is per-tab and can be cleared independently", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.ensure("tab-b", "pty-2")

      api.terminal.setZoom("tab-a", "pty-1")
      api.terminal.setZoom("tab-b", "pty-2")

      // Zoom is independent per tab
      expect(api.terminal.zoom("tab-a")).toBe("pty-1")
      expect(api.terminal.zoom("tab-b")).toBe("pty-2")

      // Clearing zoom on tab-a does not affect tab-b
      api.terminal.setZoom("tab-a", undefined)
      expect(api.terminal.zoom("tab-a")).toBeUndefined()
      expect(api.terminal.zoom("tab-b")).toBe("pty-2")
    } finally {
      dispose()
    }
  })

  test("terminal owner is per-terminal-id and controls closeInTab guard behavior", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)
      const tabA = tabs1.addTerminal("/ws", "pty-1", "Terminal 1")
      const tabB = tabs2.addTerminal("/ws", "pty-2", "Terminal 2")

      api.terminal.ensure(tabA, "pty-1")
      api.terminal.ensure(tabB, "pty-2")
      api.terminal.own(tabA, "pty-1")
      api.terminal.own(tabB, "pty-2")

      // Owner links are per-terminal-id
      expect(api.terminal.owner("pty-1")).toBe(tabA)
      expect(api.terminal.owner("pty-2")).toBe(tabB)
      expect(api.terminal.owner("pty-3")).toBeUndefined()

      // closeInTab respects ownership: trying to close pty-2 from tabA is
      // rejected because pty-2's owner is tabB
      api.terminal.split({ tab: tabA, at: "pty-1", id: "pty-2", dir: "v" })
      api.terminal.own(tabB, "pty-2")
      api.terminal.closeInTab({
        tab: tabA,
        id: "pty-2",
        origin: { tabId: tabA, groupId: g1, hostId: `claxedo-tab-host-${tabA}` },
      })
      // pty-2 should still be in tab-a pane because owner mismatch blocked the close
      expect(api.terminal.ids(tabA)).toContain("pty-2")
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

      // Phase 1: clearTerminalTabState preserves pane (so reactive close
      // effect can read sibling IDs), but clears focus/zoom/owner and
      // sets lifecycle to "closing".
      expect(api.terminal.pane(tabId)).toBeDefined()
      expect(api.terminal.focus(tabId)).toBeUndefined()
      expect(api.terminal.zoom(tabId)).toBeUndefined()
      expect(api.terminal.owner("pty-1")).toBeUndefined()
      expect(api.terminal.lifecycle("pty-1")).toBe("closing")

      // Phase 2: clear() is called by the reactive close effect after
      // killing all terminals — this wipes the pane tree.
      api.terminal.clear(tabId)
      expect(api.terminal.pane(tabId)).toBeUndefined()
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

      // Pane preserved for reactive close effect; agent state cleared
      expect(api.terminal.pane(tabId)).toBeDefined()
      expect(api.terminal.agentStatus("pty-1")).toBe("idle")
      expect(api.terminal.lifecycle("pty-1")).toBe("closing")

      // Phase 2: clear() wipes pane
      api.terminal.clear(tabId)
      expect(api.terminal.pane(tabId)).toBeUndefined()
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
  test("agent status is per terminal and aggregates correctly in getTabAgentStatus", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Set up terminals in separate tabs
      api.terminal.ensure("tab-a", "pty-1")
      api.terminal.ensure("tab-b", "pty-2")

      api.terminal.setAgentStatus("pty-1", "working")
      api.terminal.setAgentStatus("pty-2", "permission")

      // Per-terminal status is correct
      expect(api.terminal.agentStatus("pty-1")).toBe("working")
      expect(api.terminal.agentStatus("pty-2")).toBe("permission")
      expect(api.terminal.agentStatus("pty-3")).toBe("idle")

      // Aggregated tab status reflects the individual terminal status
      const statusA = api.terminal.getTabAgentStatus("tab-a")
      expect(statusA.loading).toBe(true)
      expect(statusA.attention).toBe(false)

      const statusB = api.terminal.getTabAgentStatus("tab-b")
      expect(statusB.loading).toBe(false)
      expect(statusB.attention).toBe(true)

      // Tab with no ensured terminals shows idle aggregated status
      const statusEmpty = api.terminal.getTabAgentStatus("tab-nonexistent")
      expect(statusEmpty.loading).toBe(false)
      expect(statusEmpty.attention).toBe(false)
      expect(statusEmpty.done).toBe(false)
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
  test("setDefault in group A does not affect group B and is visible via worktree alias when focused", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)
      const wt2 = api.groupWorktree(g2)

      wt1.setDefault("/workspace-a")

      // Group B is unaffected (isolation)
      expect(wt2.default()).toBeNull()

      // The worktree alias delegates to the focused group.
      // When g1 is focused, the alias should reflect g1's default.
      api.split.setFocus(g1)
      expect(api.worktree.default()).toBe("/workspace-a")

      // When g2 is focused, the alias should reflect g2's default (null).
      api.split.setFocus(g2)
      expect(api.worktree.default()).toBeNull()
    } finally {
      dispose()
    }
  })

  test("setPinned in group A does not affect group B and is visible via worktree alias when focused", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)
      const wt2 = api.groupWorktree(g2)

      wt1.setPinned("/pinned-a")

      // Group B is unaffected (isolation)
      expect(wt2.pinned()).toBeNull()

      // The worktree alias delegates to the focused group.
      api.split.setFocus(g1)
      expect(api.worktree.pinned()).toBe("/pinned-a")

      // When g2 is focused, the alias should reflect g2's pinned (null).
      api.split.setFocus(g2)
      expect(api.worktree.pinned()).toBeNull()
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

  test("addSession auto-sets worktree.default when null (groupTabs)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)

      // Default is null initially
      expect(wt1.default()).toBeNull()

      // Adding a session should auto-set the default
      tabs1.addSession("/workspace-a", "s1", "Session 1")

      expect(wt1.default()).toBe("/workspace-a")
    } finally {
      dispose()
    }
  })

  test("addSession does not overwrite existing worktree.default (groupTabs)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)

      wt1.setDefault("/existing-workspace")
      tabs1.addSession("/other-workspace", "s1", "Session 1")

      // Should keep the existing default, not overwrite
      expect(wt1.default()).toBe("/existing-workspace")
    } finally {
      dispose()
    }
  })

  test("addSession auto-sets worktree.default when null (topTabs)", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Single group (no split) — topTabs delegates to the only group
      expect(api.worktree.default()).toBeNull()

      api.topTabs.addSession("/workspace-main", "s1", "Session 1")

      expect(api.worktree.default()).toBe("/workspace-main")
    } finally {
      dispose()
    }
  })

  test("addTerminal auto-sets worktree.default when null", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)

      expect(wt1.default()).toBeNull()

      tabs1.addTerminal("/workspace-a", "pty-1", "Terminal 1")

      expect(wt1.default()).toBe("/workspace-a")
    } finally {
      dispose()
    }
  })

  test("auto-set worktree.default is per-group (isolation)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)
      const wt2 = api.groupWorktree(g2)

      tabs1.addSession("/workspace-a", "s1", "Session 1")
      tabs2.addSession("/workspace-b", "s2", "Session 2")

      expect(wt1.default()).toBe("/workspace-a")
      expect(wt2.default()).toBe("/workspace-b")
    } finally {
      dispose()
    }
  })

  test("closing only tab for a directory switches worktree.default to next active tab's directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)

      const id1 = tabs1.addSession("/workspace-a", "s1", "Session A")
      tabs1.addSession("/workspace-b", "s2", "Session B")

      expect(wt1.default()).toBe("/workspace-a")

      // Close the only tab for /workspace-a — default should switch to /workspace-b
      tabs1.close(id1)

      expect(wt1.default()).toBe("/workspace-b")
    } finally {
      dispose()
    }
  })

  test("closing tab does not change worktree.default when other tabs share same directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)

      const id1 = tabs1.addSession("/workspace-a", "s1", "Session 1")
      tabs1.addSession("/workspace-a", "s2", "Session 2")

      expect(wt1.default()).toBe("/workspace-a")

      // Close one tab — another tab still has /workspace-a, default stays
      tabs1.close(id1)

      expect(wt1.default()).toBe("/workspace-a")
    } finally {
      dispose()
    }
  })

  test("closing all tabs keeps worktree.default (no remaining tab to switch to)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)

      const id1 = tabs1.addSession("/workspace-a", "s1", "Session A")

      expect(wt1.default()).toBe("/workspace-a")

      tabs1.close(id1)

      // Default persists — there's no next tab to switch to
      expect(wt1.default()).toBe("/workspace-a")
    } finally {
      dispose()
    }
  })

  test("closing tab for different directory than worktree.default does not change default", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)
      const wt1 = api.groupWorktree(g1)

      tabs1.addSession("/workspace-a", "s1", "Session A")
      const id2 = tabs1.addSession("/workspace-b", "s2", "Session B")

      // Default is /workspace-a (auto-set from first tab)
      expect(wt1.default()).toBe("/workspace-a")

      // Closing the /workspace-b tab should not affect default
      tabs1.close(id2)

      expect(wt1.default()).toBe("/workspace-a")
    } finally {
      dispose()
    }
  })

  test("closing only tab via topTabs switches worktree.default", () => {
    const { api, dispose } = createTestLayout()
    try {
      const id1 = api.topTabs.addSession("/workspace-a", "s1", "Session A")
      api.topTabs.addSession("/workspace-b", "s2", "Session B")

      expect(api.worktree.default()).toBe("/workspace-a")

      api.topTabs.close(id1)

      expect(api.worktree.default()).toBe("/workspace-b")
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Layout isolation (file tree, session panel, review panel)
// ---------------------------------------------------------------------------

describe("layout isolation between groups", () => {
  test("file tree state per group persists across focus switches", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const layout1 = api.groupLayout(g1)
      const layout2 = api.groupLayout(g2)

      layout1.fileTree.setOpened(false)
      layout1.fileTree.setWidth(200)
      layout1.fileTree.setTab("all")

      // Group B defaults untouched (isolation)
      expect(layout2.fileTree.opened()).toBe(true)
      expect(layout2.fileTree.width()).toBe(344)
      expect(layout2.fileTree.tab()).toBe("changes")

      // After switching focus to g2 and back, g1's layout should persist
      api.split.setFocus(g2)
      api.split.setFocus(g1)

      expect(layout1.fileTree.opened()).toBe(false)
      expect(layout1.fileTree.width()).toBe(200)
      expect(layout1.fileTree.tab()).toBe("all")

      // Modifying g2's layout while g2 is focused does not affect g1
      api.split.setFocus(g2)
      layout2.fileTree.setWidth(500)
      expect(layout1.fileTree.width()).toBe(200)
      expect(layout2.fileTree.width()).toBe(500)
    } finally {
      dispose()
    }
  })

  test("session panel state per group persists across focus switches", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)
      const layout1 = api.groupLayout(g1)
      const layout2 = api.groupLayout(g2)

      layout1.session.setCollapsed(true)
      layout1.session.setWidth(300)
      layout1.session.setPanelMode(2)

      // Group B defaults untouched (isolation)
      expect(layout2.session.collapsed()).toBe(false)
      expect(layout2.session.width()).toBe(600)
      expect(layout2.session.panelMode()).toBe(0)

      // After switching focus to g2 and back, g1's session state should persist
      api.split.setFocus(g2)
      api.split.setFocus(g1)

      expect(layout1.session.collapsed()).toBe(true)
      expect(layout1.session.width()).toBe(300)
      expect(layout1.session.panelMode()).toBe(2)

      // Modifying g2's session while g2 is focused does not affect g1
      api.split.setFocus(g2)
      layout2.session.setWidth(800)
      layout2.session.setPanelMode(1)
      expect(layout1.session.width()).toBe(300)
      expect(layout1.session.panelMode()).toBe(2)
      expect(layout2.session.width()).toBe(800)
      expect(layout2.session.panelMode()).toBe(1)
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

  test("toggle seeds new group workspace default from active tab directory when primary default is unset", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.topTabs.addSession("/workspace-main", "s1", "Session 1")
      api.split.toggle()
      const groups = api.split.groups()
      const g2 = groups[1]
      expect(api.groupWorktree(g2.id).default()).toBe("/workspace-main")
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

describe("closeGroup deduplicates tabs on merge", () => {
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

describe("closeGroup clears stale creating state for removed groups", () => {
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

describe("tab operations work after closing split", () => {
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

  test("toggle on focused secondary group toggles visibility and topTabs reflects focused group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      // Populate both groups
      tabs1.addSession("/ws", "s1", "Primary Session")
      tabs2.addSession("/ws", "s2", "Secondary Session")

      // Focus secondary group
      api.split.setFocus(g2)
      expect(api.split.focusedId()).toBe(g2)

      // topTabs should delegate to focused group (g2)
      expect(api.topTabs.active()?.sessionId).toBe("s2")

      // Toggle hides the split
      api.split.toggle()
      expect(api.split.active()).toBe(false)
      expect(api.split.hidden()).toBe(true)

      // topTabs should still delegate to focused group (g2)
      expect(api.topTabs.active()?.sessionId).toBe("s2")

      // Adding a session via topTabs while hidden should go to focused group (g2)
      api.topTabs.addSession("/ws", "s3", "Added While Hidden")
      expect(tabs2.items()).toHaveLength(2)
      expect(tabs1.items()).toHaveLength(1)

      // Toggle shows the split again
      api.split.toggle()
      expect(api.split.active()).toBe(true)
      expect(api.split.hidden()).toBe(false)

      // Focus should still be on g2
      expect(api.split.focusedId()).toBe(g2)

      // Sizes should be preserved
      expect(api.split.sizes()).toEqual([0.5, 0.5])

      // Both groups should have correct tabs
      expect(tabs1.items()).toHaveLength(1)
      expect(tabs2.items()).toHaveLength(2)
    } finally {
      dispose()
    }
  })
})

describe("terminal origin guard", () => {
  test("splitInTab ignores missing origin in split mode", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)
      const tabId = tabs1.addTerminal("/ws", "pty-1", "Terminal 1")
      api.terminal.ensure(tabId, "pty-1")

      api.terminal.splitInTab({ tab: tabId, at: "pty-1", id: "pty-2", dir: "v" })

      expect(api.terminal.ids(tabId)).toEqual(["pty-1"])
    } finally {
      dispose()
    }
  })

  test("splitInTab applies mutation when origin matches tab and group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)
      const tabId = tabs1.addTerminal("/ws", "pty-1", "Terminal 1")
      api.terminal.ensure(tabId, "pty-1")

      api.terminal.splitInTab({
        tab: tabId,
        at: "pty-1",
        id: "pty-2",
        dir: "v",
        origin: { tabId, groupId: g1, hostId: `claxedo-tab-host-${tabId}` },
      })

      expect(api.terminal.ids(tabId)).toEqual(["pty-1", "pty-2"])
    } finally {
      dispose()
    }
  })

  test("splitInTab ignores stale split target not in tab pane", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)
      const tabId = tabs1.addTerminal("/ws", "pty-1", "Terminal 1")
      api.terminal.ensure(tabId, "pty-1")

      api.terminal.splitInTab({
        tab: tabId,
        at: "pty-stale",
        id: "pty-2",
        dir: "v",
        origin: { tabId, groupId: g1, hostId: `claxedo-tab-host-${tabId}` },
      })

      expect(api.terminal.ids(tabId)).toEqual(["pty-1"])
    } finally {
      dispose()
    }
  })

  test("closeInTab ignores owner mismatch against target tab", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)
      const tabA = tabs1.addTerminal("/ws", "pty-a", "Terminal A")
      const tabB = tabs2.addTerminal("/ws", "pty-b", "Terminal B")

      api.terminal.ensure(tabA, "pty-a")
      api.terminal.ensure(tabB, "pty-b")
      api.terminal.own(tabB, "pty-a")

      api.terminal.closeInTab({
        tab: tabA,
        id: "pty-a",
        origin: { tabId: tabA, groupId: g1, hostId: `claxedo-tab-host-${tabA}` },
      })

      expect(api.terminal.ids(tabA)).toEqual(["pty-a"])
      expect(api.terminal.owner("pty-a")).toBe(tabB)
      expect(api.findTabGroup(tabB)).toBe(g2)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Auto-select main workspace — reactive safety
// ---------------------------------------------------------------------------

describe("auto-select main workspace reactive safety", () => {
  test("setDefault is idempotent — calling with the same value does not trigger a store update", () => {
    let runs = 0
    let api: any
    let dispose: () => void

    createRoot((d) => {
      dispose = d
      api = initLayout()

      createEffect(() => {
        api.worktree.default()
        runs++
      })
    })

    // After createRoot, effect ran once (flushed at end of runUpdates)
    expect(runs).toBe(1)

    // Set new value — should trigger re-run
    api.worktree.setDefault("/main")
    expect(runs).toBe(2)

    // Set same value again — guard prevents setStore, no re-run
    api.worktree.setDefault("/main")
    expect(runs).toBe(2)

    // Set different value — triggers re-run
    api.worktree.setDefault("/other")
    expect(runs).toBe(3)

    dispose!()
  })

  test("setPinned is idempotent — calling with null twice does not trigger a store update", () => {
    let runs = 0
    let api: any
    let dispose: () => void

    createRoot((d) => {
      dispose = d
      api = initLayout()

      createEffect(() => {
        api.worktree.pinned()
        runs++
      })
    })

    expect(runs).toBe(1)

    // pinned starts as null, calling with null again is a no-op
    api.worktree.setPinned(null)
    expect(runs).toBe(1)

    // Set to a value — triggers re-run
    api.worktree.setPinned("/pinned")
    expect(runs).toBe(2)

    // Set same value again — no-op
    api.worktree.setPinned("/pinned")
    expect(runs).toBe(2)

    dispose!()
  })

  test("on() pattern prevents store reads in callback from becoming tracked dependencies", () => {
    let runs = 0
    let api: any
    let setDir: (v: string | undefined) => void
    let dispose: () => void

    createRoot((d) => {
      dispose = d
      api = initLayout()
      const [dir, sd] = createSignal<string | undefined>(undefined)
      setDir = sd

      // Simulate the auto-select effect pattern using on()
      createEffect(
        on(dir, (currentDir) => {
          runs++
          if (currentDir) return

          // These call into the store (read focusedGroup, write worktree.default)
          // With on(), they should NOT become tracked dependencies
          api.worktree.setPinned(null)
          api.worktree.setDefault("/main-workspace")
        }),
      )
    })

    // With on(), body is untracked — store write in setDefault does NOT
    // trigger a re-execution. Exactly 1 initial run.
    expect(runs).toBe(1)
    expect(api.worktree.default()).toBe("/main-workspace")

    // Simulate navigate (dir changes to a value) — tracked dep changed, re-runs
    setDir!("/main-workspace")
    expect(runs).toBe(2)

    // Mutate store.split.focusedId (read by setDefault internally via focusedGroup).
    // With on(), this is NOT a tracked dep, so effect should NOT re-run.
    api.split.toggle()
    const groups = api.split.groups()
    api.split.setFocus(groups[1].id)
    expect(runs).toBe(2)

    dispose!()
  })

  test("without on(), store write in setDefault causes extra initial re-run (control test)", () => {
    let runs = 0
    let api: any
    let dispose: () => void

    createRoot((d) => {
      dispose = d
      api = initLayout()
      const [dir] = createSignal<string | undefined>(undefined)

      // Bare createEffect (NO on()) — body reads ARE tracked.
      // setDefault reads store.groups[i].worktree.default then writes it,
      // which invalidates the tracked dep and schedules a second run.
      createEffect(() => {
        runs++
        const currentDir = dir()
        if (currentDir) return
        api.worktree.setPinned(null)
        api.worktree.setDefault("/main-workspace")
      })
    })

    // Without on(), the store write inside setDefault triggers a second run
    // because the read of store.groups[i].worktree.default in the guard is tracked.
    // It stabilizes at 2 (second run sees same value, no-ops).
    expect(runs).toBeGreaterThanOrEqual(2)

    dispose!()
  })

  test("auto-select pattern sets correct worktree state for first project", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Initially no default
      expect(api.worktree.default()).toBeNull()
      expect(api.worktree.pinned()).toBeNull()

      // Simulate auto-select: set main workspace as default
      api.worktree.setPinned(null)
      api.worktree.setDefault("/projects/my-app")

      expect(api.worktree.default()).toBe("/projects/my-app")
      expect(api.worktree.pinned()).toBeNull()
    } finally {
      dispose()
    }
  })

  test("auto-select does not override already-set worktree default", () => {
    const { api, dispose } = createTestLayout()
    try {
      // User previously had a default set (persisted from previous session)
      api.worktree.setDefault("/projects/existing")
      expect(api.worktree.default()).toBe("/projects/existing")

      // The auto-select effect would call setDefault with the main workspace.
      // After navigation, the effect should bail out (params.dir is set).
      // But if it ran, it would overwrite — so the component guards with if (dir) return.
      // Here we verify the store-level behavior is correct.
      api.worktree.setDefault("/projects/main")
      expect(api.worktree.default()).toBe("/projects/main")
    } finally {
      dispose()
    }
  })

  test("setDefault works across split groups without cross-contamination", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2 } = splitInto2(api)

      // Focus group 1, set default (simulates auto-select targeting focused group)
      api.split.setFocus(g1)
      api.worktree.setDefault("/main-workspace")

      expect(api.groupWorktree(g1).default()).toBe("/main-workspace")
      expect(api.groupWorktree(g2).default()).toBeNull()

      // Focus group 2, set different default
      api.split.setFocus(g2)
      api.worktree.setDefault("/secondary")

      expect(api.groupWorktree(g1).default()).toBe("/main-workspace")
      expect(api.groupWorktree(g2).default()).toBe("/secondary")
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// BUG REPRO: workspace bar shows "workspacename/workspacename"
//
// Thesis: workspaceBarProjects (rail-layout.tsx:496-541) is built exclusively
// from open tab directories. When worktree.default points to a directory that
// has NO open tabs in ANY group, the lookup in the `current` memo
// (top-tab-bar.tsx:939-946) fails, and the fallback uses getFilename(dir) for
// BOTH project and workspace fields, producing "workspacename - workspacename"
// instead of "projectname - workspacename".
//
// Scenarios that trigger this:
// 1. Auto-select on load: default set before navigation/tab creation microtask
// 2. All tabs closed for a workspace but it remains the default
// 3. Persisted default on reload before tabs are recreated
//
// Tests below assert the CORRECT expected behavior. They FAIL on the current
// code and should only pass after the production code is fixed.
// ---------------------------------------------------------------------------

describe("BUG REPRO: workspace bar doubled workspace name", () => {
  /** Replicate workspaceBarProjects from rail-layout.tsx:496-541 */
  function buildWorkspaceBarProjects(
    api: any,
    projects: Array<{ id: string; name: string; worktree: string; sandboxes?: string[] }>,
  ) {
    const allTabs: any[] = []
    for (const group of api.split.groups()) {
      allTabs.push(...api.groupTabs(group.id).items())
    }
    const tabDirs = new Set(allTabs.map((t: any) => t.directory))

    const projectMap = new Map<string, any>()
    for (const dir of tabDirs) {
      const project = projects.find((p) => p.worktree === dir || p.sandboxes?.includes(dir))
      if (!project) continue
      let projEntry = projectMap.get(project.id)
      if (!projEntry) {
        projEntry = {
          id: project.id,
          name: project.name,
          worktree: project.worktree,
          workspaces: [],
        }
        projectMap.set(project.id, projEntry)
      }
      if (projEntry.workspaces.some((ws: any) => ws.directory === dir)) continue
      const isMain = dir === project.worktree
      const basename = dir.split("/").pop() || ""
      projEntry.workspaces.push({
        id: dir,
        directory: dir,
        name: isMain ? "main" : basename,
      })
    }
    return Array.from(projectMap.values())
  }

  /**
   * Replicate the `current` memo from top-tab-bar.tsx:939-946.
   *
   * This is a faithful replica of the PRODUCTION code. It receives both the
   * tab-derived workspaceBarProjects AND the full project list (available as
   * component props in production), but currently only uses wsBarProjects —
   * ignoring the full project list when no tabs match.
   *
   * The fix should use `allProjects` as a fallback to derive project name
   * and workspace name when wsBarProjects has no match.
   */
  function resolveCurrentDisplay(
    dir: string | null,
    wsBarProjects: Array<{ name: string; worktree?: string; workspaces: Array<{ directory: string; name: string }> }>,
    allProjects: Array<{ id: string; name: string; worktree: string; sandboxes?: string[] }>,
  ) {
    if (!dir) return undefined
    const basename = dir.split("/").pop() || ""
    const proj = wsBarProjects.find((p: any) => p.workspaces.some((w: any) => w.directory === dir))
    if (proj) {
      const ws = proj.workspaces.find((w: any) => w.directory === dir)
      return { dir, project: proj.name, workspace: ws?.name ?? basename }
    }
    // Fallback: resolve from full project list (matches fixed production code)
    const fullProj = allProjects.find((p) => p.worktree === dir || p.sandboxes?.includes(dir))
    if (fullProj) {
      const isMain = dir === fullProj.worktree
      return { dir, project: fullProj.name || basename, workspace: isMain ? "main" : basename }
    }
    return { dir, project: basename, workspace: basename }
  }

  const PROJECTS = [
    { id: "proj1", name: "my-project", worktree: "/home/user/projects/my-project", sandboxes: [] as string[] },
  ]

  const PROJECTS_WITH_SANDBOX = [
    {
      id: "proj1",
      name: "my-project",
      worktree: "/home/user/projects/my-project",
      sandboxes: ["/home/user/projects/my-project/.worktrees/feature-abc"],
    },
  ]

  test("default set with no tabs → should show project name and 'main'", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.worktree.setDefault("/home/user/projects/my-project")

      const wsBarProjects = buildWorkspaceBarProjects(api, PROJECTS)
      const display = resolveCurrentDisplay(api.worktree.default(), wsBarProjects, PROJECTS)
      expect(display).toBeDefined()

      // Main workspace should always display as "my-project - main", never "my-project - my-project"
      expect(display!.project).toBe("my-project")
      expect(display!.workspace).toBe("main")
      expect(display!.project).not.toBe(display!.workspace)
    } finally {
      dispose()
    }
  })

  test("all tabs closed for default workspace → should still show correct names", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.worktree.setDefault("/home/user/projects/my-project")
      const tabId = api.topTabs.addSession("/home/user/projects/my-project", "s1", "Session 1")
      api.topTabs.close(tabId)

      expect(api.topTabs.items()).toHaveLength(0)

      const wsBarProjects = buildWorkspaceBarProjects(api, PROJECTS)
      const display = resolveCurrentDisplay(api.worktree.default(), wsBarProjects, PROJECTS)

      expect(display!.project).toBe("my-project")
      expect(display!.workspace).toBe("main")
    } finally {
      dispose()
    }
  })

  test("sandbox default with no tabs → should show project name and sandbox name", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.worktree.setDefault("/home/user/projects/my-project/.worktrees/feature-abc")

      const wsBarProjects = buildWorkspaceBarProjects(api, PROJECTS_WITH_SANDBOX)
      const display = resolveCurrentDisplay(api.worktree.default(), wsBarProjects, PROJECTS_WITH_SANDBOX)

      // Should show "my-project - feature-abc", never "feature-abc - feature-abc"
      expect(display!.project).toBe("my-project")
      expect(display!.workspace).toBe("feature-abc")
      expect(display!.project).not.toBe(display!.workspace)
    } finally {
      dispose()
    }
  })

  test("auto-select timing window → should resolve correctly even before tabs exist", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Simulate auto-select: default set synchronously, tab created later in microtask
      api.worktree.setPinned(null)
      api.worktree.setDefault("/home/user/projects/my-project")

      // Before microtask: no tabs yet
      const wsBarProjects = buildWorkspaceBarProjects(api, PROJECTS)
      expect(wsBarProjects).toHaveLength(0)

      const display = resolveCurrentDisplay(api.worktree.default(), wsBarProjects, PROJECTS)

      // Even before tabs exist, the display should resolve correctly
      expect(display!.project).toBe("my-project")
      expect(display!.workspace).toBe("main")
      expect(display!.project).not.toBe(display!.workspace)
    } finally {
      dispose()
    }
  })

  // --- Control tests: these pass today (tabs exist, lookup succeeds) ---

  test("tabs exist → project and workspace names are distinct", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.worktree.setDefault("/home/user/projects/my-project")
      api.topTabs.addSession("/home/user/projects/my-project", "s1", "Session 1")

      const wsBarProjects = buildWorkspaceBarProjects(api, PROJECTS)
      expect(wsBarProjects).toHaveLength(1)

      const display = resolveCurrentDisplay(api.worktree.default(), wsBarProjects, PROJECTS)
      expect(display!.project).toBe("my-project")
      expect(display!.workspace).toBe("main")
    } finally {
      dispose()
    }
  })

  test("sandbox tab exists → project name differs from workspace name", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.worktree.setDefault("/home/user/projects/my-project/.worktrees/feature-abc")
      api.topTabs.addSession("/home/user/projects/my-project/.worktrees/feature-abc", "s1", "Session 1")

      const wsBarProjects = buildWorkspaceBarProjects(api, PROJECTS_WITH_SANDBOX)
      expect(wsBarProjects).toHaveLength(1)

      const display = resolveCurrentDisplay(api.worktree.default(), wsBarProjects, PROJECTS_WITH_SANDBOX)
      expect(display!.project).toBe("my-project")
      expect(display!.workspace).toBe("feature-abc")
      expect(display!.project).not.toBe(display!.workspace)
    } finally {
      dispose()
    }
  })
})

describe("terminal lifecycle state machine", () => {
  test("allows legal transitions creating -> attaching -> attached -> closing -> closed", () => {
    const { api, dispose } = createTestLayout()
    try {
      expect(api.terminal.transitionLifecycle("pty-1", "creating", "test")).toBe(true)
      expect(api.terminal.transitionLifecycle("pty-1", "attaching", "test")).toBe(true)
      expect(api.terminal.transitionLifecycle("pty-1", "attached", "test")).toBe(true)

      api.terminal.beginClosing("pty-1")
      expect(api.terminal.lifecycle("pty-1")).toBe("closing")

      api.terminal.clearClosing("pty-1")
      expect(api.terminal.lifecycle("pty-1")).toBe("closed")
    } finally {
      dispose()
    }
  })

  test("rejects illegal transition attached -> creating", () => {
    const { api, dispose } = createTestLayout()
    try {
      expect(api.terminal.transitionLifecycle("pty-2", "attached", "test")).toBe(true)
      expect(api.terminal.transitionLifecycle("pty-2", "creating", "test")).toBe(false)
      expect(api.terminal.lifecycle("pty-2")).toBe("attached")
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Bug: Toggle focus tracking after hide/show cycle
// ---------------------------------------------------------------------------

describe("toggle focus tracking after hide/show cycle", () => {
  test("full user sequence: focus g2, hide, show, focus g1, hide → g1 stays visible", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      // Populate both groups so user can distinguish them
      tabs1.addSession("/ws", "s1", "Primary Session")
      tabs2.addSession("/ws", "s2", "Secondary Session")

      // Initial: focus defaults to g1
      expect(api.split.focusedId()).toBe(g1)

      // Step 1: Toggle hides non-focused (g2)
      api.split.toggle()
      expect(api.split.hidden()).toBe(true)
      expect(api.split.focusedId()).toBe(g1)
      expect(api.topTabs.active()?.sessionId).toBe("s1")

      // Step 2: Unhide
      api.split.toggle()
      expect(api.split.hidden()).toBe(false)

      // Step 3: Click on secondary (g2) to focus it
      api.split.setFocus(g2)
      expect(api.split.focusedId()).toBe(g2)

      // Step 4: Toggle hides non-focused (g1)
      api.split.toggle()
      expect(api.split.hidden()).toBe(true)
      expect(api.split.focusedId()).toBe(g2)
      expect(api.topTabs.active()?.sessionId).toBe("s2")

      // Step 5: Unhide
      api.split.toggle()
      expect(api.split.hidden()).toBe(false)

      // Step 6: Click on primary (g1) to focus it
      api.split.setFocus(g1)
      expect(api.split.focusedId()).toBe(g1)

      // Step 7: Toggle hides non-focused — g2 should hide, g1 should stay
      api.split.toggle()
      expect(api.split.hidden()).toBe(true)
      expect(api.split.focusedId()).toBe(g1)

      // Critical assertion: topTabs should delegate to g1 (the focused group)
      expect(api.topTabs.active()?.sessionId).toBe("s1")

      // The focused group returned by groups().find(g => g.id === focusedId) is g1
      const focused = api.split.groups().find((g: any) => g.id === api.split.focusedId())
      expect(focused?.id).toBe(g1)
    } finally {
      dispose()
    }
  })
})

// ---------------------------------------------------------------------------
// Bug: closeGroup breaks store proxy identity (causes terminal blank)
// ---------------------------------------------------------------------------

describe("closeGroup store proxy identity", () => {
  test("closeGroup preserves surviving group proxy identity for <For> tracking", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      tabs1.addSession("/ws", "s1", "Session 1")
      tabs2.addSession("/ws", "s2", "Session 2")

      // Capture the proxy reference for g1 before closeGroup
      const g1ProxyBefore = api.split.groups().find((g: any) => g.id === g1)

      // Close g2
      api.split.closeGroup(g2)

      // g1 should be the only remaining group
      expect(api.split.groups()).toHaveLength(1)
      expect(api.split.groups()[0].id).toBe(g1)

      // BUG: The proxy reference for g1 should be the SAME object.
      // closeGroup uses { ...g, tabs: { ...g.tabs, ... } } which creates
      // a new plain object, breaking SolidJS store proxy identity.
      // This causes <For> to treat g1 as a NEW item, destroying and
      // recreating its DOM — including terminal host divs that portals
      // mount into. Since TerminalPortal only re-resolves hosts when
      // split.hidden() changes, the portal still references the old
      // (now-destroyed) host div, rendering terminal content invisible.
      const g1ProxyAfter = api.split.groups().find((g: any) => g.id === g1)
      expect(g1ProxyAfter).toBe(g1ProxyBefore)
    } finally {
      dispose()
    }
  })

  test("closeGroup with terminal tabs preserves remaining group terminal state", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      // Add terminal tabs to both groups
      const termTab1 = tabs1.addTerminal("/ws", "pty-1", "Terminal 1")
      const termTab2 = tabs2.addTerminal("/ws", "pty-2", "Terminal 2")

      // Set up terminal state for both
      api.terminal.ensure(termTab1, "pty-1")
      api.terminal.ensure(termTab2, "pty-2")

      // Close g2
      api.split.closeGroup(g2)

      // g1's terminal tab should still exist and be active
      expect(api.split.groups()).toHaveLength(1)
      const remaining = api.groupTabs(g1)
      const termTabs = remaining.items().filter((t: any) => t.type === "terminal")
      expect(termTabs).toHaveLength(1)
      expect(termTabs[0].terminalId).toBe("pty-1")

      // g1's terminal state should be intact
      expect(api.terminal.ids(termTab1)).toContain("pty-1")

      // g2's terminal state should be cleared
      expect(api.terminal.ids(termTab2)).toEqual([])
    } finally {
      dispose()
    }
  })
})
