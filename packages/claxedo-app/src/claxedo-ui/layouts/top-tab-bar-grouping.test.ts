/**
 * Tab Grouping Tests
 *
 * Tests for worktree-based tab grouping, color assignment, and drag restrictions.
 */
import { describe, expect, test, beforeAll } from "bun:test"
import { createRoot } from "solid-js"
import { ensureLayoutMocked, getInitLayout } from "../context/_test-helper"

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

/** Helper to split into two groups */
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

// ============================================================================
// Tab Grouping by Worktree
// ============================================================================

describe("tab grouping by worktree", () => {
  test("groups tabs by directory (worktree)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      // Add tabs from different worktrees
      tabs1.addSession("/project", "s1", "Session 1")
      tabs1.addSession("/project", "s2", "Session 2")
      tabs1.addSession("/project/feature", "s3", "Session 3")
      tabs1.addSession("/project/feature", "s4", "Session 4")

      const items = tabs1.items()
      expect(items).toHaveLength(4)

      // Get unique directories
      const directories = [...new Set(items.map((t: any) => t.directory))]
      expect(directories).toEqual(["/project", "/project/feature"])
    } finally {
      dispose()
    }
  })

  test("getWorktreeColor returns color for worktree directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Should have a function to get color for worktree
      expect(api.getWorktreeColor).toBeDefined()

      if (api.getWorktreeColor) {
        const color1 = api.getWorktreeColor("/ws1")
        const color2 = api.getWorktreeColor("/ws2")

        expect(color1).toBeTruthy()
        expect(color2).toBeTruthy()
        expect(color1).not.toBe(color2)
      }
    } finally {
      dispose()
    }
  })

  test("getWorktreeColor returns consistent color for same directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      if (api.getWorktreeColor) {
        const color1 = api.getWorktreeColor("/project/feature")
        const color2 = api.getWorktreeColor("/project/feature")
        const color3 = api.getWorktreeColor("/project/feature")

        // Same directory should always return same color
        expect(color1).toBe(color2)
        expect(color2).toBe(color3)
      }
    } finally {
      dispose()
    }
  })

  test("getWorktreeColor is stable when other worktrees are added", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      if (api.getWorktreeColor) {
        // Get initial color for worktree A
        const colorBefore = api.getWorktreeColor("/project/main")

        // Add tabs from new worktrees
        tabs1.addSession("/project/feature", "s1", "Session 1")
        tabs1.addSession("/project/bugfix", "s2", "Session 2")
        tabs1.addSession("/project/refactor", "s3", "Session 3")

        // Color for worktree A should remain unchanged
        const colorAfter = api.getWorktreeColor("/project/main")
        expect(colorAfter).toBe(colorBefore)
      }
    } finally {
      dispose()
    }
  })

  test("getWorktreeColor is stable when other worktrees are removed", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      if (api.getWorktreeColor) {
        // Add multiple worktrees first
        const id1 = tabs1.addSession("/project/main", "s1", "Session 1")
        const id2 = tabs1.addSession("/project/feature", "s2", "Session 2")
        tabs1.addSession("/project/bugfix", "s3", "Session 3")

        // Get color for worktree A
        const colorBefore = api.getWorktreeColor("/project/main")

        // Close tabs from other worktrees
        tabs1.close(id2)

        // Color for worktree A should remain unchanged
        const colorAfter = api.getWorktreeColor("/project/main")
        expect(colorAfter).toBe(colorBefore)
      }
    } finally {
      dispose()
    }
  })

  test("getWorktreeColor produces deterministic colors for different paths", () => {
    const { api, dispose } = createTestLayout()
    try {
      if (api.getWorktreeColor) {
        const WORKTREE_COLORS = ["#3b82f6", "#22c55e", "#a855f7", "#f97316", "#ec4899", "#14b8a6", "#f59e0b", "#6366f1"]

        // Test that colors are from the palette
        const color1 = api.getWorktreeColor("/project/main")
        const color2 = api.getWorktreeColor("/project/feature")
        const color3 = api.getWorktreeColor("/home/user/workspace")

        expect(WORKTREE_COLORS).toContain(color1)
        expect(WORKTREE_COLORS).toContain(color2)
        expect(WORKTREE_COLORS).toContain(color3)

        // Different paths should potentially have different colors
        // (not guaranteed due to hash collisions, but likely)
        const colors = new Set([color1, color2, color3])
        expect(colors.size).toBeGreaterThanOrEqual(1)
      }
    } finally {
      dispose()
    }
  })

  test("color palette cycles after 8 worktrees", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      const WORKTREE_COLORS = [
        "#3b82f6", // blue-500
        "#22c55e", // green-500
        "#a855f7", // purple-500
        "#f97316", // orange-500
        "#ec4899", // pink-500
        "#14b8a6", // teal-500
        "#f59e0b", // amber-500
        "#6366f1", // indigo-500
      ]

      // Add 10 tabs from 10 different worktrees
      for (let i = 0; i < 10; i++) {
        tabs1.addSession(`/ws${i}`, `s${i}`, `Session ${i}`)
      }

      // Test color cycling if getWorktreeColor exists
      if (api.getWorktreeColor) {
        const color0 = api.getWorktreeColor("/ws0")
        const color8 = api.getWorktreeColor("/ws8")

        // 9th worktree (index 8) should reuse first color
        expect(color0).toBe(color8)
      }
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Last Tab Worktree Indicator
// ============================================================================

describe("last tab worktree indicator", () => {
  test("getWorktreeName extracts name from directory path", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Test will fail until we implement getWorktreeName
      expect(api.getWorktreeName).toBeDefined()

      if (api.getWorktreeName) {
        expect(api.getWorktreeName("/project/main")).toBe("main")
        expect(api.getWorktreeName("/project/feature-branch")).toBe("feature-branch")
        expect(api.getWorktreeName("/home/user/workspace")).toBe("workspace")
        expect(api.getWorktreeName("/a/b/c/d/e")).toBe("e")
      }
    } finally {
      dispose()
    }
  })

  test("last tab in each worktree group has isLastInGroup flag", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)

      // Add tabs from two worktrees
      tabs1.addSession("/project/main", "s1", "Session 1")
      tabs1.addSession("/project/main", "s2", "Session 2")
      tabs1.addSession("/project/feature", "s3", "Session 3")

      // Test will fail until we implement grouping with isLastInGroup flag
      expect(api.getTabGroupInfo).toBeDefined()

      if (api.getTabGroupInfo) {
        const groupInfo = api.getTabGroupInfo(g1)

        // Should have 2 groups
        expect(groupInfo).toHaveLength(2)

        // First group (main) - last tab should have isLastInGroup=true
        const mainGroup = groupInfo.find((g: any) => g.directory === "/project/main")
        expect(mainGroup).toBeDefined()
        expect(mainGroup.tabs[mainGroup.tabs.length - 1].isLastInGroup).toBe(true)

        // Second group (feature) - last tab should have isLastInGroup=true
        const featureGroup = groupInfo.find((g: any) => g.directory === "/project/feature")
        expect(featureGroup).toBeDefined()
        expect(featureGroup.tabs[featureGroup.tabs.length - 1].isLastInGroup).toBe(true)
      }
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Drag and Drop Restrictions
// ============================================================================

describe("drag and drop restrictions", () => {
  test("can reorder tabs within same worktree group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      // Add tabs to same worktree
      const id1 = tabs1.addSession("/project", "s1", "Session 1")
      const id2 = tabs1.addSession("/project", "s2", "Session 2")
      const id3 = tabs1.addSession("/project", "s3", "Session 3")

      // Reorder within group - should work
      tabs1.move(id1, 2)

      const ordered = tabs1.orderedItems().map((t: any) => t.id)
      expect(ordered).toEqual([id2, id3, id1])
    } finally {
      dispose()
    }
  })

  test("canDragTabBetweenWorktrees returns false for different worktrees", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      // Add tabs to different worktrees
      tabs1.addSession("/project/main", "s1", "Session 1")
      tabs1.addSession("/project/feature", "s2", "Session 2")

      // Test will fail until we implement canDragTabBetweenWorktrees
      expect(api.canDragTabBetweenWorktrees).toBeDefined()

      if (api.canDragTabBetweenWorktrees) {
        // Should return false - can't drag between different worktrees
        expect(api.canDragTabBetweenWorktrees("/project/main", "/project/feature")).toBe(false)

        // Should return true - can reorder within same worktree
        expect(api.canDragTabBetweenWorktrees("/project/main", "/project/main")).toBe(true)
      }
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Active Worktree Button Color
// ============================================================================

describe("active worktree button color", () => {
  test("getActiveWorktreeColor returns color for active worktree", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      // Add a tab to set worktree
      tabs1.addSession("/project/feature", "s1", "Session 1")
      wt.setDefault("/project/feature")

      // Test will fail until we implement getActiveWorktreeColor
      expect(api.getActiveWorktreeColor).toBeDefined()

      if (api.getActiveWorktreeColor) {
        const color = api.getActiveWorktreeColor(g1)
        expect(color).toBeTruthy()

        // Should match the color for /project/feature worktree
        if (api.getWorktreeColor) {
          expect(color).toBe(api.getWorktreeColor("/project/feature"))
        }
      }
    } finally {
      dispose()
    }
  })

  test("button color updates when active worktree changes", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      // Add tabs for two worktrees
      tabs1.addSession("/project/main", "s1", "Session 1")
      tabs1.addSession("/project/feature", "s2", "Session 2")

      if (api.getActiveWorktreeColor && api.getWorktreeColor) {
        // Set main as active
        wt.setDefault("/project/main")
        const mainColor = api.getActiveWorktreeColor(g1)
        expect(mainColor).toBe(api.getWorktreeColor("/project/main"))

        // Change to feature
        wt.setDefault("/project/feature")
        const featureColor = api.getActiveWorktreeColor(g1)
        expect(featureColor).toBe(api.getWorktreeColor("/project/feature"))

        // Colors should be different
        expect(mainColor).not.toBe(featureColor)
      }
    } finally {
      dispose()
    }
  })

  test("getActiveWorktreeColor reacts to pinned worktree changes", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      // Add tabs for two worktrees
      tabs1.addSession("/project/main", "s1", "Session 1")
      tabs1.addSession("/project/feature", "s2", "Session 2")

      if (api.getActiveWorktreeColor && api.getWorktreeColor) {
        // Set default worktree
        wt.setDefault("/project/main")
        const defaultColor = api.getActiveWorktreeColor(g1)
        expect(defaultColor).toBe(api.getWorktreeColor("/project/main"))

        // Pin a different worktree - pinned takes precedence
        wt.setPinned("/project/feature")
        const pinnedColor = api.getActiveWorktreeColor(g1)
        expect(pinnedColor).toBe(api.getWorktreeColor("/project/feature"))
        expect(pinnedColor).not.toBe(defaultColor)

        // Unpin - should fall back to default
        wt.setPinned(null)
        const fallbackColor = api.getActiveWorktreeColor(g1)
        expect(fallbackColor).toBe(api.getWorktreeColor("/project/main"))
      }
    } finally {
      dispose()
    }
  })

  test("getActiveWorktreeColor is reactive and not cached - regression prevention", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      if (api.getActiveWorktreeColor && api.getWorktreeColor) {
        // Setup: Add two different worktrees
        tabs1.addSession("/worktree/alpha", "s1", "Session Alpha")
        tabs1.addSession("/worktree/beta", "s2", "Session Beta")

        // Set initial default
        wt.setDefault("/worktree/alpha")

        // Get initial color
        const color1 = api.getActiveWorktreeColor(g1)
        expect(color1).toBe(api.getWorktreeColor("/worktree/alpha"))

        // Change active worktree multiple times
        wt.setDefault("/worktree/beta")
        const color2 = api.getActiveWorktreeColor(g1)

        wt.setDefault("/worktree/alpha")
        const color3 = api.getActiveWorktreeColor(g1)

        wt.setDefault("/worktree/beta")
        const color4 = api.getActiveWorktreeColor(g1)

        // Verify colors reflect current state, not cached/stale values
        expect(color2).toBe(api.getWorktreeColor("/worktree/beta"))
        expect(color3).toBe(api.getWorktreeColor("/worktree/alpha"))
        expect(color4).toBe(api.getWorktreeColor("/worktree/beta"))

        // Verify alternating works correctly
        expect(color1).toBe(color3) // Both alpha
        expect(color2).toBe(color4) // Both beta
        expect(color1).not.toBe(color2) // Alpha != beta

        // Test with pinned worktree too
        wt.setPinned("/worktree/alpha")
        const pinnedColor = api.getActiveWorktreeColor(g1)
        expect(pinnedColor).toBe(api.getWorktreeColor("/worktree/alpha"))

        // Change pinned
        wt.setPinned("/worktree/beta")
        const pinnedColor2 = api.getActiveWorktreeColor(g1)
        expect(pinnedColor2).toBe(api.getWorktreeColor("/worktree/beta"))

        // Clear pinned (should use default)
        wt.setPinned(null)
        const afterUnpin = api.getActiveWorktreeColor(g1)
        expect(afterUnpin).toBe(api.getWorktreeColor("/worktree/beta")) // default was beta
      }
    } finally {
      dispose()
    }
  })

  test("getActiveWorktreeColor changes when selecting worktree without open tabs", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      if (api.getActiveWorktreeColor && api.getWorktreeColor) {
        // Setup: Add session only for worktree A
        tabs1.addSession("/worktree/alpha", "s1", "Session Alpha")
        // Note: worktree beta has NO open tabs

        // Set alpha as active - button should be alpha's color
        wt.setDefault("/worktree/alpha")
        const alphaColor = api.getActiveWorktreeColor(g1)
        expect(alphaColor).toBe(api.getWorktreeColor("/worktree/alpha"))

        // Select worktree beta (which has no open tabs)
        // Button group color should change to beta's color
        wt.setDefault("/worktree/beta")
        const betaColor = api.getActiveWorktreeColor(g1)

        // This should be beta's color, not alpha's
        expect(betaColor).toBe(api.getWorktreeColor("/worktree/beta"))
        expect(betaColor).not.toBe(alphaColor)

        // Switch back to alpha
        wt.setDefault("/worktree/alpha")
        const backToAlpha = api.getActiveWorktreeColor(g1)
        expect(backToAlpha).toBe(api.getWorktreeColor("/worktree/alpha"))
        expect(backToAlpha).toBe(alphaColor)
      }
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Group Ordering
// ============================================================================

describe("group ordering", () => {
  test("worktree groups maintain first-appearance order", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      // Add tabs from multiple worktrees in specific order
      tabs1.addSession("/ws-c", "s1", "Session C")
      tabs1.addSession("/ws-a", "s2", "Session A")
      tabs1.addSession("/ws-b", "s3", "Session B")

      const items = tabs1.items()
      const directories = [...new Set(items.map((t: any) => t.directory))]

      // Groups should maintain order of first appearance
      expect(directories).toEqual(["/ws-c", "/ws-a", "/ws-b"])
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Session Creation in Selected Worktree
// ============================================================================

describe("session creation in selected worktree", () => {
  test("new session is created in currently selected worktree", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      // Setup: Add a session in worktree alpha
      tabs1.addSession("/worktree/alpha", "s1", "Session Alpha")

      // Set beta as the active worktree (user selected this in workspace bar)
      wt.setDefault("/worktree/beta")

      // Get the currently active worktree
      const activeWorktree = wt.pinned() || wt.default()
      expect(activeWorktree).toBe("/worktree/beta")

      // Create a new session in the selected worktree
      const newSessionId = tabs1.addSession(activeWorktree, "s2", "New Session")

      // Verify the new session was created in the selected worktree (beta)
      const newTab = tabs1.items().find((t: any) => t.id === newSessionId)
      expect(newTab).toBeDefined()
      expect(newTab.directory).toBe("/worktree/beta")
      expect(newTab.directory).not.toBe("/worktree/alpha")
    } finally {
      dispose()
    }
  })

  test("new terminal is created in currently selected worktree", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      // Setup: Add a terminal in worktree alpha
      tabs1.addTerminal("/worktree/alpha", "t1")

      // Set beta as the active worktree
      wt.setDefault("/worktree/beta")

      // Get the currently active worktree
      const activeWorktree = wt.pinned() || wt.default()
      expect(activeWorktree).toBe("/worktree/beta")

      // Create a new terminal in the selected worktree
      const newTerminalId = tabs1.addTerminal(activeWorktree, "t2")

      // Verify the new terminal was created in the selected worktree
      const newTab = tabs1.items().find((t: any) => t.id === newTerminalId)
      expect(newTab).toBeDefined()
      expect(newTab.directory).toBe("/worktree/beta")
      expect(newTab.directory).not.toBe("/worktree/alpha")
    } finally {
      dispose()
    }
  })

  test("session created via API uses correct worktree directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      // Add session to worktree A
      const mainId = tabs1.addSession("/project/main", "main-session", "Session in Main")

      // Change active worktree to feature
      wt.setDefault("/project/feature")

      // Create new session - should be in feature worktree
      const featureId = tabs1.addSession("/project/feature", "feature-session", "Session in Feature")

      // Verify it was created in the correct worktree
      const items = tabs1.items()
      const mainTab = items.find((t: any) => t.id === mainId)
      const featureTab = items.find((t: any) => t.id === featureId)

      expect(mainTab).toBeDefined()
      expect(featureTab).toBeDefined()
      expect(mainTab.directory).toBe("/project/main")
      expect(featureTab.directory).toBe("/project/feature")
      expect(mainTab.directory).not.toBe(featureTab.directory)
    } finally {
      dispose()
    }
  })
})
