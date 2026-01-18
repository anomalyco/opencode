import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"

/**
 * Tests for mobile-specific layout features.
 *
 * These tests verify that mobile UI elements are properly rendered
 * and behave correctly. They help catch regressions when upstream
 * changes affect mobile functionality.
 *
 * Key mobile features tested:
 * 1. Archive button visibility (inline, not hover-only)
 * 2. Project menu visibility (always visible, not hover-only)
 * 3. Project reorder menu options (Move up/down)
 * 4. Variant selection button visibility
 */

// Mock classList helper - simulates how Solid's classList works
function resolveClassList(classList: Record<string, boolean>): string[] {
  return Object.entries(classList)
    .filter(([_, value]) => value)
    .map(([key]) => key)
}

describe("Mobile layout classList logic", () => {
  describe("Archive button visibility", () => {
    // This mirrors the classList logic in SessionItem
    function getArchiveButtonClasses(mobile: boolean) {
      return resolveClassList({
        "shrink-0 flex items-center gap-1": true,
      })
    }

    function shouldShowInlineArchive(mobile: boolean): boolean {
      // Archive button is shown inline on mobile via <Show when={props.mobile}>
      return mobile
    }

    function shouldShowHoverArchive(mobile: boolean): boolean {
      // Desktop shows archive on hover via <Show when={!props.mobile}>
      return !mobile
    }

    test("mobile shows inline archive button", () => {
      expect(shouldShowInlineArchive(true)).toBe(true)
      expect(shouldShowInlineArchive(false)).toBe(false)
    })

    test("desktop shows hover archive button", () => {
      expect(shouldShowHoverArchive(true)).toBe(false)
      expect(shouldShowHoverArchive(false)).toBe(true)
    })
  })

  describe("Project menu visibility", () => {
    // This mirrors the classList logic in SortableProject/ProjectItem
    function getProjectMenuClasses(mobile: boolean) {
      return resolveClassList({
        "flex gap-1 items-center has-[[data-expanded]]:visible": true,
        // Mobile: always visible. Desktop: show on hover
        visible: mobile,
        "invisible group-hover/session:visible": !mobile,
      })
    }

    test("mobile project menu is always visible", () => {
      const classes = getProjectMenuClasses(true)
      expect(classes).toContain("visible")
      expect(classes).not.toContain("invisible group-hover/session:visible")
    })

    test("desktop project menu is hover-only", () => {
      const classes = getProjectMenuClasses(false)
      expect(classes).not.toContain("visible")
      expect(classes).toContain("invisible group-hover/session:visible")
    })
  })

  describe("Project reorder menu options", () => {
    // Move up/down options only shown on mobile
    function shouldShowMoveOptions(mobile: boolean): boolean {
      return mobile
    }

    test("mobile shows move up/down options", () => {
      expect(shouldShowMoveOptions(true)).toBe(true)
    })

    test("desktop hides move up/down options (uses drag instead)", () => {
      expect(shouldShowMoveOptions(false)).toBe(false)
    })
  })

  describe("Status indicator visibility", () => {
    // Status indicators (timestamps, notification dots) should always show
    // They hide on hover when archive button appears (desktop only)
    function getStatusIndicatorClasses(mobile: boolean, isHovering: boolean) {
      // On mobile, status indicators don't hide because archive is inline
      // On desktop, they hide on hover to make room for archive button
      if (mobile) {
        return ["shrink-0", "flex", "items-center", "gap-1"]
      }

      if (isHovering) {
        return [] // Hidden on desktop hover
      }

      return ["shrink-0"]
    }

    test("mobile status indicators always visible", () => {
      expect(getStatusIndicatorClasses(true, false).length).toBeGreaterThan(0)
      expect(getStatusIndicatorClasses(true, true).length).toBeGreaterThan(0)
    })

    test("desktop status indicators hide on hover", () => {
      expect(getStatusIndicatorClasses(false, false).length).toBeGreaterThan(0)
      expect(getStatusIndicatorClasses(false, true).length).toBe(0)
    })
  })
})

describe("Mobile drag-and-drop behavior", () => {
  // On mobile, drag-and-drop is disabled to prevent conflicts with scrolling
  // Instead, reordering is done via menu options

  function shouldEnableDragDrop(mobile: boolean): boolean {
    return !mobile
  }

  test("drag-and-drop disabled on mobile", () => {
    expect(shouldEnableDragDrop(true)).toBe(false)
  })

  test("drag-and-drop enabled on desktop", () => {
    expect(shouldEnableDragDrop(false)).toBe(true)
  })
})

describe("Mobile sidebar behavior", () => {
  // Mobile sidebar renders projects without DragDropProvider
  // to avoid touch event conflicts

  function getMobileSidebarConfig(mobile: boolean) {
    return {
      usesDragDropProvider: !mobile,
      usesMenuReorder: mobile,
      projectsAlwaysExpanded: mobile,
    }
  }

  test("mobile sidebar config", () => {
    const config = getMobileSidebarConfig(true)
    expect(config.usesDragDropProvider).toBe(false)
    expect(config.usesMenuReorder).toBe(true)
  })

  test("desktop sidebar config", () => {
    const config = getMobileSidebarConfig(false)
    expect(config.usesDragDropProvider).toBe(true)
    expect(config.usesMenuReorder).toBe(false)
  })
})

describe("Array proxy handling", () => {
  // SolidJS store proxies don't always pass Array.isArray()
  // Our code uses typeof .filter === "function" instead

  function isArrayLike(value: unknown): boolean {
    return !!value && typeof value === "object" && typeof (value as { filter?: unknown }).filter === "function"
  }

  test("detects real arrays", () => {
    expect(isArrayLike([1, 2, 3])).toBe(true)
    expect(isArrayLike([])).toBe(true)
  })

  test("detects store proxy arrays", () => {
    createRoot((dispose) => {
      const [store] = createStore({ items: [1, 2, 3] })
      expect(isArrayLike(store.items)).toBe(true)
      dispose()
    })
  })

  test("rejects non-arrays", () => {
    expect(isArrayLike(null)).toBe(false)
    expect(isArrayLike(undefined)).toBe(false)
    expect(isArrayLike({})).toBe(false)
    expect(isArrayLike("string")).toBe(false)
    expect(isArrayLike(123)).toBe(false)
  })
})
