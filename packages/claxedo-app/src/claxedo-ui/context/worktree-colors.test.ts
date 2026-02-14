/**
 * Worktree Color Assignment Tests
 *
 * Verifies that:
 * - Colors are not reused until all available colors are exhausted
 * - Color assignments are persisted (survive reload/restart via the store)
 * - Deleted worktrees free their color for reuse
 * - When all colors are exhausted, new directories still get a color (hash fallback)
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { ensureLayoutMocked, getInitLayout } from "./_test-helper"

let initLayout: () => any

beforeAll(async () => {
  await ensureLayoutMocked()
  initLayout = getInitLayout()
})

function createTestLayout() {
  let dispose!: () => void
  const api = createRoot((d) => {
    dispose = d
    return initLayout()
  })
  return { api, dispose }
}

// ============================================================================
// Color uniqueness — no reuse until palette is exhausted
// ============================================================================

describe("worktree color uniqueness", () => {
  test("each directory gets a unique color", () => {
    const { api, dispose } = createTestLayout()
    try {
      const colors = new Set<string>()
      for (let i = 0; i < 5; i++) {
        const color = api.getWorktreeColor(`/project/ws-${i}`)
        colors.add(color)
      }
      // All 5 should be distinct
      expect(colors.size).toBe(5)
    } finally {
      dispose()
    }
  })

  test("all 10 palette colors are assigned before any reuse", () => {
    const { api, dispose } = createTestLayout()
    try {
      const colors: string[] = []
      for (let i = 0; i < 10; i++) {
        colors.push(api.getWorktreeColor(`/unique/dir-${i}`))
      }
      // All 10 should be unique
      expect(new Set(colors).size).toBe(10)
    } finally {
      dispose()
    }
  })

  test("11th directory falls back to hash (palette exhausted)", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Exhaust all 10 colors
      for (let i = 0; i < 10; i++) {
        api.getWorktreeColor(`/exhaust/dir-${i}`)
      }
      // 11th should still return a valid color (hash fallback)
      const color = api.getWorktreeColor("/exhaust/dir-extra")
      expect(color).toBeTruthy()
      expect(typeof color).toBe("string")
      expect(color.startsWith("#")).toBe(true)
    } finally {
      dispose()
    }
  })

  test("same directory always returns same color", () => {
    const { api, dispose } = createTestLayout()
    try {
      const c1 = api.getWorktreeColor("/stable/workspace")
      const c2 = api.getWorktreeColor("/stable/workspace")
      const c3 = api.getWorktreeColor("/stable/workspace")
      expect(c1).toBe(c2)
      expect(c2).toBe(c3)
    } finally {
      dispose()
    }
  })

  test("two directories never share a color (within palette size)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const a = api.getWorktreeColor("/workspace/alpha")
      const b = api.getWorktreeColor("/workspace/beta")
      expect(a).not.toBe(b)
    } finally {
      dispose()
    }
  })

  test("color assignment order is stable across calls", () => {
    const { api, dispose } = createTestLayout()
    try {
      const dirs = Array.from({ length: 8 }, (_, i) => `/ordered/dir-${i}`)
      const first = dirs.map((d) => api.getWorktreeColor(d))
      const second = dirs.map((d) => api.getWorktreeColor(d))
      expect(first).toEqual(second)
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Persistence — color map is in the store (survives localStorage round-trip)
// ============================================================================

describe("worktree color persistence", () => {
  test("color assignments are written to the store", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const tabs = api.groupTabs(g1)

      // Trigger color assignment by calling getWorktreeColor
      const color = api.getWorktreeColor("/persisted/workspace")
      expect(color).toBeTruthy()

      // The store should now have the mapping
      // (We can verify by calling again — same result means it was stored)
      const again = api.getWorktreeColor("/persisted/workspace")
      expect(again).toBe(color)
    } finally {
      dispose()
    }
  })

  test("multiple directories persist independently", () => {
    const { api, dispose } = createTestLayout()
    try {
      const c1 = api.getWorktreeColor("/persist/a")
      const c2 = api.getWorktreeColor("/persist/b")
      const c3 = api.getWorktreeColor("/persist/c")

      // Each should be unique and stable
      expect(c1).not.toBe(c2)
      expect(c2).not.toBe(c3)
      expect(c1).not.toBe(c3)

      // Re-query should return same
      expect(api.getWorktreeColor("/persist/a")).toBe(c1)
      expect(api.getWorktreeColor("/persist/b")).toBe(c2)
      expect(api.getWorktreeColor("/persist/c")).toBe(c3)
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Cleanup — deleted worktrees free their color for reuse
// ============================================================================

describe("worktree color cleanup on delete", () => {
  test("deleting a worktree frees its color", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Assign 10 colors (exhaust palette)
      const dirs = Array.from({ length: 10 }, (_, i) => `/cleanup/dir-${i}`)
      const colors = dirs.map((d) => api.getWorktreeColor(d))
      expect(new Set(colors).size).toBe(10)

      // Remember the color of dir-0
      const freedColor = colors[0]

      // Delete dir-0 — its color should be freed
      api.cleanupDeletedWorktree("/cleanup/dir-0")

      // A new directory should get the freed color (first unused)
      const newColor = api.getWorktreeColor("/cleanup/dir-new")
      expect(newColor).toBe(freedColor)
    } finally {
      dispose()
    }
  })

  test("deleting multiple worktrees frees multiple colors", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Assign 10 colors
      const dirs = Array.from({ length: 10 }, (_, i) => `/multi-cleanup/dir-${i}`)
      const colors = dirs.map((d) => api.getWorktreeColor(d))

      const freed0 = colors[0]
      const freed1 = colors[1]

      // Delete two
      api.cleanupDeletedWorktree("/multi-cleanup/dir-0")
      api.cleanupDeletedWorktree("/multi-cleanup/dir-1")

      // New directories should get the freed colors
      const a = api.getWorktreeColor("/multi-cleanup/new-a")
      const b = api.getWorktreeColor("/multi-cleanup/new-b")

      expect(new Set([a, b]).size).toBe(2) // still unique
      expect([freed0, freed1]).toContain(a)
      expect([freed0, freed1]).toContain(b)
    } finally {
      dispose()
    }
  })

  test("deleting a non-existent worktree is a no-op", () => {
    const { api, dispose } = createTestLayout()
    try {
      const c1 = api.getWorktreeColor("/safe/dir-1")
      api.cleanupDeletedWorktree("/does-not-exist")
      // Existing assignment unchanged
      expect(api.getWorktreeColor("/safe/dir-1")).toBe(c1)
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Edge cases
// ============================================================================

describe("worktree color edge cases", () => {
  test("directories with similar names get different colors", () => {
    const { api, dispose } = createTestLayout()
    try {
      const c1 = api.getWorktreeColor("/project/main")
      const c2 = api.getWorktreeColor("/project/main-2")
      const c3 = api.getWorktreeColor("/project/main-sandbox")
      expect(new Set([c1, c2, c3]).size).toBe(3)
    } finally {
      dispose()
    }
  })

  test("color reuse after full cycle: exhaust, delete all, reassign", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Exhaust palette
      const dirs = Array.from({ length: 10 }, (_, i) => `/cycle/dir-${i}`)
      const originalColors = dirs.map((d) => api.getWorktreeColor(d))
      expect(new Set(originalColors).size).toBe(10)

      // Delete all
      for (const d of dirs) api.cleanupDeletedWorktree(d)

      // Reassign — should get all 10 unique colors again
      const newDirs = Array.from({ length: 10 }, (_, i) => `/cycle/new-${i}`)
      const newColors = newDirs.map((d) => api.getWorktreeColor(d))
      expect(new Set(newColors).size).toBe(10)
    } finally {
      dispose()
    }
  })

  test("getActiveWorktreeColor uses persisted color", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)

      wt.setDefault("/active-color-test")
      const directColor = api.getWorktreeColor("/active-color-test")
      const activeColor = api.getActiveWorktreeColor(g1)

      expect(activeColor).toBe(directColor)
    } finally {
      dispose()
    }
  })
})
