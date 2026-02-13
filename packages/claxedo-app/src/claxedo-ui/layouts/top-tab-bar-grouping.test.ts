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

/** The 8-color palette used by getWorktreeColor. */
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
  test("returns a color from the palette for different directories", () => {
    const { api, dispose } = createTestLayout()
    try {
      const color1 = api.getWorktreeColor("/ws1")
      const color2 = api.getWorktreeColor("/ws2")

      expect(WORKTREE_COLORS).toContain(color1)
      expect(WORKTREE_COLORS).toContain(color2)
      expect(color1).not.toBe(color2)
    } finally {
      dispose()
    }
  })

  test("returns the same color for the same directory across calls", () => {
    const { api, dispose } = createTestLayout()
    try {
      const color1 = api.getWorktreeColor("/project/feature")
      const color2 = api.getWorktreeColor("/project/feature")
      const color3 = api.getWorktreeColor("/project/feature")

      expect(color1).toBe(color2)
      expect(color2).toBe(color3)
      expect(WORKTREE_COLORS).toContain(color1)
    } finally {
      dispose()
    }
  })

  test("color is stable when other worktrees are added", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      // Get initial color for worktree
      const colorBefore = api.getWorktreeColor("/project/main")

      // Add tabs from new worktrees
      tabs1.addSession("/project/feature", "s1", "Session 1")
      tabs1.addSession("/project/bugfix", "s2", "Session 2")
      tabs1.addSession("/project/refactor", "s3", "Session 3")

      // Color should remain unchanged (hash-based, not index-based)
      const colorAfter = api.getWorktreeColor("/project/main")
      expect(colorAfter).toBe(colorBefore)
    } finally {
      dispose()
    }
  })

  test("color is stable when other worktrees are removed", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      // Add multiple worktrees first
      tabs1.addSession("/project/main", "s1", "Session 1")
      const id2 = tabs1.addSession("/project/feature", "s2", "Session 2")
      tabs1.addSession("/project/bugfix", "s3", "Session 3")

      const colorBefore = api.getWorktreeColor("/project/main")

      // Close tabs from other worktrees
      tabs1.close(id2)

      // Color should remain unchanged
      const colorAfter = api.getWorktreeColor("/project/main")
      expect(colorAfter).toBe(colorBefore)
    } finally {
      dispose()
    }
  })

  test("different paths produce distinct palette colors", () => {
    const { api, dispose } = createTestLayout()
    try {
      const color1 = api.getWorktreeColor("/project/main")
      const color2 = api.getWorktreeColor("/project/feature")
      const color3 = api.getWorktreeColor("/home/user/workspace")

      // Each color must come from the palette
      expect(WORKTREE_COLORS).toContain(color1)
      expect(WORKTREE_COLORS).toContain(color2)
      expect(WORKTREE_COLORS).toContain(color3)

      // These specific paths produce 3 distinct colors
      expect(new Set([color1, color2, color3]).size).toBe(3)
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Last Tab Worktree Indicator
// ============================================================================

describe("last tab worktree indicator", () => {
  test("extracts the last path segment as worktree name", () => {
    const { api, dispose } = createTestLayout()
    try {
      expect(api.getWorktreeName("/project/main")).toBe("main")
      expect(api.getWorktreeName("/project/feature-branch")).toBe("feature-branch")
      expect(api.getWorktreeName("/home/user/workspace")).toBe("workspace")
      expect(api.getWorktreeName("/a/b/c/d/e")).toBe("e")
    } finally {
      dispose()
    }
  })

  test("marks the last tab in each worktree group with isLastInGroup", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1 } = splitInto2(api)

      // Add tabs from two worktrees
      tabs1.addSession("/project/main", "s1", "Session 1")
      tabs1.addSession("/project/main", "s2", "Session 2")
      tabs1.addSession("/project/feature", "s3", "Session 3")

      const groupInfo = api.getTabGroupInfo(g1)

      // Should have 2 groups
      expect(groupInfo).toHaveLength(2)

      // First group (main) — last tab should have isLastInGroup=true
      const mainGroup = groupInfo.find((g: any) => g.directory === "/project/main")
      expect(mainGroup).toBeDefined()
      expect(mainGroup.tabs).toHaveLength(2)
      expect(mainGroup.tabs[0].isLastInGroup).toBe(false)
      expect(mainGroup.tabs[1].isLastInGroup).toBe(true)
      expect(WORKTREE_COLORS).toContain(mainGroup.color)

      // Second group (feature) — single tab is also last
      const featureGroup = groupInfo.find((g: any) => g.directory === "/project/feature")
      expect(featureGroup).toBeDefined()
      expect(featureGroup.tabs).toHaveLength(1)
      expect(featureGroup.tabs[0].isLastInGroup).toBe(true)
      expect(WORKTREE_COLORS).toContain(featureGroup.color)
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

      // Reorder within group — should work
      tabs1.move(id1, 2)

      const ordered = tabs1.orderedItems().map((t: any) => t.id)
      expect(ordered).toEqual([id2, id3, id1])
    } finally {
      dispose()
    }
  })

  test("returns false for different worktrees, true for same worktree", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { tabs1 } = splitInto2(api)

      // Add tabs to different worktrees
      tabs1.addSession("/project/main", "s1", "Session 1")
      tabs1.addSession("/project/feature", "s2", "Session 2")

      // Cannot drag between different worktrees
      expect(api.canDragTabBetweenWorktrees("/project/main", "/project/feature")).toBe(false)

      // Can reorder within same worktree
      expect(api.canDragTabBetweenWorktrees("/project/main", "/project/main")).toBe(true)
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Active Worktree Button Color
// ============================================================================

describe("active worktree button color", () => {
  test("returns the color matching the active worktree directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      tabs1.addSession("/project/feature", "s1", "Session 1")
      wt.setDefault("/project/feature")

      const color = api.getActiveWorktreeColor(g1)
      expect(color).toBe(api.getWorktreeColor("/project/feature"))
    } finally {
      dispose()
    }
  })

  test("updates when the active worktree changes", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      tabs1.addSession("/project/main", "s1", "Session 1")
      tabs1.addSession("/project/feature", "s2", "Session 2")

      wt.setDefault("/project/main")
      const mainColor = api.getActiveWorktreeColor(g1)
      expect(mainColor).toBe(api.getWorktreeColor("/project/main"))

      wt.setDefault("/project/feature")
      const featureColor = api.getActiveWorktreeColor(g1)
      expect(featureColor).toBe(api.getWorktreeColor("/project/feature"))

      expect(mainColor).not.toBe(featureColor)
    } finally {
      dispose()
    }
  })

  test("pinned worktree takes precedence over default", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      tabs1.addSession("/project/main", "s1", "Session 1")
      tabs1.addSession("/project/feature", "s2", "Session 2")

      wt.setDefault("/project/main")
      const defaultColor = api.getActiveWorktreeColor(g1)
      expect(defaultColor).toBe(api.getWorktreeColor("/project/main"))

      // Pin a different worktree — pinned takes precedence
      wt.setPinned("/project/feature")
      const pinnedColor = api.getActiveWorktreeColor(g1)
      expect(pinnedColor).toBe(api.getWorktreeColor("/project/feature"))
      expect(pinnedColor).not.toBe(defaultColor)

      // Unpin — should fall back to default
      wt.setPinned(null)
      const fallbackColor = api.getActiveWorktreeColor(g1)
      expect(fallbackColor).toBe(defaultColor)
    } finally {
      dispose()
    }
  })

  test("color tracks worktree switches via default and pinned", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      tabs1.addSession("/worktree/alpha", "s1", "Session Alpha")
      tabs1.addSession("/worktree/beta", "s2", "Session Beta")

      const alphaColor = api.getWorktreeColor("/worktree/alpha")
      const betaColor = api.getWorktreeColor("/worktree/beta")
      expect(alphaColor).not.toBe(betaColor)

      // Default to alpha
      wt.setDefault("/worktree/alpha")
      expect(api.getActiveWorktreeColor(g1)).toBe(alphaColor)

      // Switch default to beta
      wt.setDefault("/worktree/beta")
      expect(api.getActiveWorktreeColor(g1)).toBe(betaColor)

      // Switch back to alpha
      wt.setDefault("/worktree/alpha")
      expect(api.getActiveWorktreeColor(g1)).toBe(alphaColor)

      // Pin beta (overrides default)
      wt.setPinned("/worktree/beta")
      expect(api.getActiveWorktreeColor(g1)).toBe(betaColor)

      // Clear pin (falls back to default=alpha)
      wt.setPinned(null)
      expect(api.getActiveWorktreeColor(g1)).toBe(alphaColor)
    } finally {
      dispose()
    }
  })

  test("color is based on worktree path, not open tabs", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      // Only add session in alpha
      tabs1.addSession("/worktree/alpha", "s1", "Session Alpha")

      // Set alpha as active
      wt.setDefault("/worktree/alpha")
      const alphaColor = api.getActiveWorktreeColor(g1)
      expect(alphaColor).toBe(api.getWorktreeColor("/worktree/alpha"))

      // Switch to beta (which has NO open tabs)
      wt.setDefault("/worktree/beta")
      const betaColor = api.getActiveWorktreeColor(g1)
      expect(betaColor).toBe(api.getWorktreeColor("/worktree/beta"))
      expect(betaColor).not.toBe(alphaColor)
    } finally {
      dispose()
    }
  })

  test("returns undefined when no worktree is active", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1 } = splitInto2(api)

      // Neither pinned nor default is set
      const color = api.getActiveWorktreeColor(g1)
      expect(color).toBeUndefined()
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

      tabs1.addSession("/worktree/alpha", "s1", "Session Alpha")

      wt.setDefault("/worktree/beta")

      const activeWorktree = wt.pinned() || wt.default()
      expect(activeWorktree).toBe("/worktree/beta")

      const newSessionId = tabs1.addSession(activeWorktree, "s2", "New Session")

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

      tabs1.addTerminal("/worktree/alpha", "t1", "Terminal 1")

      wt.setDefault("/worktree/beta")

      const activeWorktree = wt.pinned() || wt.default()
      expect(activeWorktree).toBe("/worktree/beta")

      const newTerminalId = tabs1.addTerminal(activeWorktree, "t2", "Terminal 2")

      const newTab = tabs1.items().find((t: any) => t.id === newTerminalId)
      expect(newTab).toBeDefined()
      expect(newTab.directory).toBe("/worktree/beta")
      expect(newTab.directory).not.toBe("/worktree/alpha")
    } finally {
      dispose()
    }
  })
})
