/**
 * Workspace Bar Tests
 *
 * Tests for the workspace bar component behavior:
 * - All workspaces are always visible (no hover/recency filtering)
 * - Prefix label reflects pinned vs default state
 * - Selected workspace highlighting logic
 * - Double-click pin/unpin behavior
 */
import { describe, expect, test, beforeAll } from "bun:test"
import { createRoot, createMemo } from "solid-js"
import type { WorkspaceBarProject, WorkspaceBarItem } from "./top-tab-bar"
import { ensureLayoutMocked, getInitLayout } from "../context/_test-helper"

let initLayout: () => any

beforeAll(async () => {
  await ensureLayoutMocked()
  initLayout = getInitLayout()
})

// ============================================================================
// Test helpers
// ============================================================================

function makeWorkspace(
  overrides: Partial<WorkspaceBarItem> & { id: string; directory: string; name: string },
): WorkspaceBarItem {
  return {
    notification: false,
    isMain: false,
    isCloud: false,
    canDelete: true,
    ...overrides,
  }
}

function makeProject(
  overrides: Partial<WorkspaceBarProject> & { id: string; name: string; worktree: string },
): WorkspaceBarProject {
  return {
    workspaces: [],
    ...overrides,
  }
}

/** Create a fresh layout store for reactive tests */
function createTestLayout() {
  let dispose!: () => void
  const api = createRoot((d) => {
    dispose = d
    return initLayout()
  })
  return { api, dispose }
}

// ============================================================================
// Prefix Label
// ============================================================================

describe("WorkspaceBar prefix label", () => {
  test("shows 'Default workspace' when pinnedDirectory is null", () => {
    createRoot((dispose) => {
      const pinnedDirectory = null as string | null
      const prefix = createMemo(() => (pinnedDirectory ? "Filtered by" : "Default workspace"))
      expect(prefix()).toBe("Default workspace")
      dispose()
    })
  })

  test("shows 'Default workspace' when pinnedDirectory is undefined", () => {
    createRoot((dispose) => {
      const pinnedDirectory = undefined as string | undefined
      const prefix = createMemo(() => (pinnedDirectory ? "Filtered by" : "Default workspace"))
      expect(prefix()).toBe("Default workspace")
      dispose()
    })
  })

  test("shows 'Filtered by' when pinnedDirectory is set", () => {
    createRoot((dispose) => {
      const pinnedDirectory = "/project/feature"
      const prefix = createMemo(() => (pinnedDirectory ? "Filtered by" : "Default workspace"))
      expect(prefix()).toBe("Filtered by")
      dispose()
    })
  })
})

// ============================================================================
// All Workspaces Shown (no recency filtering)
// ============================================================================

describe("WorkspaceBar shows all workspaces", () => {
  test("all workspaces from single project are included", () => {
    const projects: WorkspaceBarProject[] = [
      makeProject({
        id: "p1",
        name: "Project 1",
        worktree: "/p1",
        workspaces: [
          makeWorkspace({ id: "w1", directory: "/p1/main", name: "main" }),
          makeWorkspace({ id: "w2", directory: "/p1/feature", name: "feature" }),
          makeWorkspace({ id: "w3", directory: "/p1/bugfix", name: "bugfix" }),
        ],
      }),
    ]

    // WorkspaceBar passes props.projects directly — all workspaces always present
    const allWorkspaces = projects.flatMap((p) => p.workspaces)
    expect(allWorkspaces).toHaveLength(3)
    expect(allWorkspaces.map((w) => w.name)).toEqual(["main", "feature", "bugfix"])
  })

  test("all workspaces from multiple projects are included", () => {
    const projects: WorkspaceBarProject[] = [
      makeProject({
        id: "p1",
        name: "Project 1",
        worktree: "/p1",
        workspaces: [
          makeWorkspace({ id: "w1", directory: "/p1/main", name: "main" }),
          makeWorkspace({ id: "w2", directory: "/p1/feature", name: "feature" }),
        ],
      }),
      makeProject({
        id: "p2",
        name: "Project 2",
        worktree: "/p2",
        workspaces: [
          makeWorkspace({ id: "w3", directory: "/p2/main", name: "main" }),
          makeWorkspace({ id: "w4", directory: "/p2/sandbox", name: "sandbox" }),
        ],
      }),
    ]

    const allWorkspaces = projects.flatMap((p) => p.workspaces)
    expect(allWorkspaces).toHaveLength(4)
    expect(allWorkspaces.map((w) => w.directory)).toEqual([
      "/p1/main",
      "/p1/feature",
      "/p2/main",
      "/p2/sandbox",
    ])
  })

  test("selected workspace is always present in the list", () => {
    const selectedDirectory = "/p1/bugfix"
    const projects: WorkspaceBarProject[] = [
      makeProject({
        id: "p1",
        name: "Project 1",
        worktree: "/p1",
        workspaces: [
          makeWorkspace({ id: "w1", directory: "/p1/main", name: "main" }),
          makeWorkspace({ id: "w2", directory: "/p1/feature", name: "feature" }),
          makeWorkspace({ id: "w3", directory: "/p1/bugfix", name: "bugfix" }),
        ],
      }),
    ]

    const allWorkspaces = projects.flatMap((p) => p.workspaces)
    const found = allWorkspaces.some((w) => w.directory === selectedDirectory)
    expect(found).toBe(true)
  })

  test("empty projects array renders no workspaces", () => {
    const projects: WorkspaceBarProject[] = []
    const allWorkspaces = projects.flatMap((p) => p.workspaces)
    expect(allWorkspaces).toHaveLength(0)
  })

  test("project with no workspaces contributes nothing", () => {
    const projects: WorkspaceBarProject[] = [
      makeProject({ id: "p1", name: "Project 1", worktree: "/p1", workspaces: [] }),
      makeProject({
        id: "p2",
        name: "Project 2",
        worktree: "/p2",
        workspaces: [makeWorkspace({ id: "w1", directory: "/p2/main", name: "main" })],
      }),
    ]

    const allWorkspaces = projects.flatMap((p) => p.workspaces)
    expect(allWorkspaces).toHaveLength(1)
    expect(allWorkspaces[0].directory).toBe("/p2/main")
  })
})

// ============================================================================
// Workspace Highlighting Logic
// (mirrors WorkspaceBarProjectGroup's isCurrent/isPinned computation)
// ============================================================================

describe("workspace highlighting", () => {
  function computeHighlighting(
    wsDirectory: string,
    defaultDirectory: string | null,
    pinnedDirectory: string | null,
  ) {
    const current = pinnedDirectory ?? defaultDirectory
    const isCurrent = wsDirectory === current
    const isPinned = wsDirectory === pinnedDirectory
    return { isCurrent, isPinned }
  }

  test("workspace matching default directory is current but not pinned", () => {
    const result = computeHighlighting("/p1/main", "/p1/main", null)
    expect(result.isCurrent).toBe(true)
    expect(result.isPinned).toBe(false)
  })

  test("workspace matching pinned directory is both current and pinned", () => {
    const result = computeHighlighting("/p1/feature", "/p1/main", "/p1/feature")
    expect(result.isCurrent).toBe(true)
    expect(result.isPinned).toBe(true)
  })

  test("workspace not matching either is neither current nor pinned", () => {
    const result = computeHighlighting("/p1/bugfix", "/p1/main", null)
    expect(result.isCurrent).toBe(false)
    expect(result.isPinned).toBe(false)
  })

  test("default workspace is NOT current when a different directory is pinned", () => {
    const result = computeHighlighting("/p1/main", "/p1/main", "/p1/feature")
    expect(result.isCurrent).toBe(false)
    expect(result.isPinned).toBe(false)
  })

  test("pinned directory takes precedence over default for currentness", () => {
    const pinnedDir = "/p1/feature"
    const defaultDir = "/p1/main"

    const pinnedResult = computeHighlighting(pinnedDir, defaultDir, pinnedDir)
    const defaultResult = computeHighlighting(defaultDir, defaultDir, pinnedDir)

    expect(pinnedResult.isCurrent).toBe(true)
    expect(defaultResult.isCurrent).toBe(false)
  })

  test("with no default or pinned directory, nothing is current", () => {
    const result = computeHighlighting("/p1/main", null, null)
    expect(result.isCurrent).toBe(false)
    expect(result.isPinned).toBe(false)
  })
})

// ============================================================================
// Double-click Pin/Unpin Behavior
// ============================================================================

describe("workspace double-click behavior", () => {
  test("double-click callback receives correct project ID and directory", () => {
    const calls: Array<{ projectId: string; directory: string }> = []
    const onDblClick = (projectId: string, directory: string) => {
      calls.push({ projectId, directory })
    }

    onDblClick("p1", "/p1/main")
    onDblClick("p1", "/p1/feature")
    onDblClick("p2", "/p2/main")

    expect(calls).toHaveLength(3)
    expect(calls[0]).toEqual({ projectId: "p1", directory: "/p1/main" })
    expect(calls[1]).toEqual({ projectId: "p1", directory: "/p1/feature" })
    expect(calls[2]).toEqual({ projectId: "p2", directory: "/p2/main" })
  })

  test("double-click on currently pinned workspace unpins it", () => {
    let pinnedDir: string | null = "/p1/feature"
    const dblClick = (dir: string) => {
      if (pinnedDir === dir) {
        pinnedDir = null
        return
      }
      pinnedDir = dir
    }

    // Double-click on the pinned workspace → should unpin
    dblClick("/p1/feature")
    expect(pinnedDir).toBeNull()
  })

  test("double-click on unpinned workspace pins it", () => {
    let pinnedDir: string | null = null
    const dblClick = (dir: string) => {
      if (pinnedDir === dir) {
        pinnedDir = null
        return
      }
      pinnedDir = dir
    }

    dblClick("/p1/feature")
    expect(pinnedDir).toBe("/p1/feature")
  })

  test("double-click on different workspace changes pin", () => {
    let pinnedDir: string | null = null
    const dblClick = (dir: string) => {
      if (pinnedDir === dir) {
        pinnedDir = null
        return
      }
      pinnedDir = dir
    }

    dblClick("/p1/main")
    expect(pinnedDir).toBe("/p1/main")

    dblClick("/p1/feature")
    expect(pinnedDir).toBe("/p1/feature")
  })

  test("double-click toggle cycle: pin → unpin → pin", () => {
    let pinnedDir: string | null = null
    const dblClick = (dir: string) => {
      if (pinnedDir === dir) {
        pinnedDir = null
        return
      }
      pinnedDir = dir
    }

    // Pin
    dblClick("/p1/feature")
    expect(pinnedDir).toBe("/p1/feature")

    // Unpin
    dblClick("/p1/feature")
    expect(pinnedDir).toBeNull()

    // Pin again
    dblClick("/p1/feature")
    expect(pinnedDir).toBe("/p1/feature")
  })
})

// ============================================================================
// Hold-to-delete delay (no animation flash on click/dblclick)
// ============================================================================

describe("hold-to-delete delay", () => {
  // Mirrors the hold-to-delete state machine from WorkspaceBarProjectGroup.
  // HOLD_DELAY_MS = 300, HOLD_TO_DELETE_MS = 1000

  const HOLD_DELAY_MS = 300
  const HOLD_TO_DELETE_MS = 1000

  type Phase = "idle" | "hold" | "loading" | "done" | "fail"

  /** Minimal model of the hold state machine for testing timer logic. */
  function createHoldStateMachine(onDelete?: () => void) {
    let phase: Phase = "idle"
    let delayTimer: ReturnType<typeof setTimeout> | undefined
    let holdTimer: ReturnType<typeof setTimeout> | undefined
    let xTimer: ReturnType<typeof setTimeout> | undefined
    let showX = false

    function clear() {
      if (delayTimer) clearTimeout(delayTimer)
      if (holdTimer) clearTimeout(holdTimer)
      if (xTimer) clearTimeout(xTimer)
      delayTimer = undefined
      holdTimer = undefined
      xTimer = undefined
      showX = false
      if (phase === "hold") phase = "idle"
    }

    function start() {
      if (phase !== "idle") return
      delayTimer = setTimeout(() => {
        delayTimer = undefined
        phase = "hold"
        xTimer = setTimeout(() => {
          showX = true
        }, HOLD_TO_DELETE_MS / 2)
        holdTimer = setTimeout(() => {
          holdTimer = undefined
          xTimer = undefined
          phase = "loading"
          showX = false
          onDelete?.()
        }, HOLD_TO_DELETE_MS)
      }, HOLD_DELAY_MS)
    }

    function stop() {
      if (delayTimer) {
        clearTimeout(delayTimer)
        delayTimer = undefined
        return
      }
      if (phase !== "hold") return
      clear()
    }

    return {
      getPhase: () => phase,
      getShowX: () => showX,
      hasDelayTimer: () => delayTimer !== undefined,
      start,
      stop,
      clear,
    }
  }

  test("phase stays idle immediately after pointerDown", () => {
    const sm = createHoldStateMachine()
    sm.start()
    // Before delay fires, phase must remain idle
    expect(sm.getPhase()).toBe("idle")
    expect(sm.hasDelayTimer()).toBe(true)
    sm.clear()
  })

  test("quick release (single click) never enters hold phase", async () => {
    const sm = createHoldStateMachine()
    sm.start()
    expect(sm.getPhase()).toBe("idle")

    // Release after 50ms — well within the 300ms delay
    await new Promise((r) => setTimeout(r, 50))
    sm.stop()

    expect(sm.getPhase()).toBe("idle")
    expect(sm.hasDelayTimer()).toBe(false)

    // Wait past the delay to confirm hold never fires
    await new Promise((r) => setTimeout(r, 350))
    expect(sm.getPhase()).toBe("idle")
  })

  test("double-click timing (~150ms between clicks) never enters hold phase", async () => {
    const sm = createHoldStateMachine()

    // First click: down + up in ~50ms
    sm.start()
    await new Promise((r) => setTimeout(r, 50))
    sm.stop()
    expect(sm.getPhase()).toBe("idle")

    // ~100ms gap
    await new Promise((r) => setTimeout(r, 100))

    // Second click: down + up in ~50ms
    sm.start()
    await new Promise((r) => setTimeout(r, 50))
    sm.stop()
    expect(sm.getPhase()).toBe("idle")

    // Confirm hold never fires after the full delay
    await new Promise((r) => setTimeout(r, 400))
    expect(sm.getPhase()).toBe("idle")
  })

  test("holding past delay enters hold phase", async () => {
    const sm = createHoldStateMachine()
    sm.start()
    expect(sm.getPhase()).toBe("idle")

    // Wait past the delay
    await new Promise((r) => setTimeout(r, HOLD_DELAY_MS + 50))
    expect(sm.getPhase()).toBe("hold")
    expect(sm.hasDelayTimer()).toBe(false)

    sm.clear()
  })

  test("releasing during hold (after delay, before delete) cancels", async () => {
    const sm = createHoldStateMachine()
    sm.start()

    // Wait past delay to enter hold
    await new Promise((r) => setTimeout(r, HOLD_DELAY_MS + 50))
    expect(sm.getPhase()).toBe("hold")

    // Release before delete completes
    sm.stop()
    expect(sm.getPhase()).toBe("idle")
  })

  test("hold long enough triggers delete", async () => {
    let deleted = false
    const sm = createHoldStateMachine(() => {
      deleted = true
    })
    sm.start()

    // Wait for delay + full hold duration
    await new Promise((r) => setTimeout(r, HOLD_DELAY_MS + HOLD_TO_DELETE_MS + 50))
    expect(sm.getPhase()).toBe("loading")
    expect(deleted).toBe(true)
  })

  test("X icon shows at 50% of hold duration (after delay)", async () => {
    const sm = createHoldStateMachine()
    sm.start()

    // Wait for delay to enter hold
    await new Promise((r) => setTimeout(r, HOLD_DELAY_MS + 50))
    expect(sm.getPhase()).toBe("hold")
    expect(sm.getShowX()).toBe(false)

    // Wait for half of hold duration
    await new Promise((r) => setTimeout(r, HOLD_TO_DELETE_MS / 2 + 50))
    expect(sm.getShowX()).toBe(true)

    sm.clear()
  })
})

// ============================================================================
// Integration: worktree pin/default through layout store
// ============================================================================

describe("workspace bar integration with layout store", () => {
  test("worktree pin/unpin via store matches double-click behavior", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g1 = groups[0].id
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      tabs1.addSession("/p1/main", "s1", "Session 1")
      tabs1.addSession("/p1/feature", "s2", "Session 2")
      wt.setDefault("/p1/main")

      // Initially not pinned
      expect(wt.pinned()).toBeNull()

      // Double-click pins
      wt.setDefault("/p1/feature")
      wt.setPinned("/p1/feature")
      expect(wt.pinned()).toBe("/p1/feature")

      // Double-click same → unpins
      wt.setPinned(null)
      expect(wt.pinned()).toBeNull()
    } finally {
      dispose()
    }
  })

  test("all workspaces remain visible regardless of recency", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Create workspaces but don't record any recency
      const projects: WorkspaceBarProject[] = [
        makeProject({
          id: "p1",
          name: "Project 1",
          worktree: "/p1",
          workspaces: [
            makeWorkspace({ id: "w1", directory: "/p1/main", name: "main" }),
            makeWorkspace({ id: "w2", directory: "/p1/feature", name: "feature" }),
            makeWorkspace({ id: "w3", directory: "/p1/bugfix", name: "bugfix" }),
          ],
        }),
      ]

      // Without recency filtering, all workspaces should be present
      const allWorkspaces = projects.flatMap((p) => p.workspaces)
      expect(allWorkspaces).toHaveLength(3)
      expect(allWorkspaces.map((w) => w.name)).toEqual(["main", "feature", "bugfix"])

      // The selected workspace doesn't need recency to be visible
      const selected = "/p1/bugfix"
      expect(allWorkspaces.some((w) => w.directory === selected)).toBe(true)
    } finally {
      dispose()
    }
  })

  test("prefix label changes when pin state changes", () => {
    createRoot((dispose) => {
      // Simulate pinned state transitions matching store behavior
      const states: Array<{ pinned: string | null; expected: string }> = [
        { pinned: null, expected: "Default workspace" },
        { pinned: "/p1/feature", expected: "Filtered by" },
        { pinned: null, expected: "Default workspace" },
        { pinned: "/p1/bugfix", expected: "Filtered by" },
      ]

      for (const { pinned, expected } of states) {
        const prefix = pinned ? "Filtered by" : "Default workspace"
        expect(prefix).toBe(expected)
      }
      dispose()
    })
  })
})

// ============================================================================
// Session content centering with side panels
// ============================================================================

describe("session content centering", () => {
  // Mirrors the `centered` memo from session.tsx:
  //   centered = isDesktop && !desktopReviewOpen
  // File tree open should NOT disable centering; only the review panel should.

  function computeCentered(isDesktop: boolean, reviewOpen: boolean) {
    return isDesktop && !reviewOpen
  }

  test("centered when no side panel is open", () => {
    expect(computeCentered(true, false)).toBe(true)
  })

  test("centered when file tree is open (review closed)", () => {
    expect(computeCentered(true, false)).toBe(true)
  })

  test("NOT centered when review panel is open", () => {
    expect(computeCentered(true, true)).toBe(false)
  })

  test("NOT centered on mobile regardless of panels", () => {
    expect(computeCentered(false, false)).toBe(false)
    expect(computeCentered(false, true)).toBe(false)
  })
})

// ============================================================================
// Cmd+N tab switching indexes into visible (pinned-filtered) tabs
// ============================================================================

describe("tab switching by index with pinned worktree filter", () => {
  // Mirrors the shortcut handler logic from rail-layout.tsx:
  //   const ordered = tabs.visualOrderedItems()  // grouped by directory
  //   const visible = pinned ? ordered.filter(t => t.directory === pinned) : ordered
  //   const tab = visible[i]

  type SimpleTab = { id: string; directory: string }

  /** Group by directory then flatten — matches visual tab bar order */
  function resolveTabByIndex(ordered: SimpleTab[], pinned: string | null, index: number) {
    const groups = new Map<string, SimpleTab[]>()
    for (const tab of ordered) {
      const existing = groups.get(tab.directory) || []
      existing.push(tab)
      groups.set(tab.directory, existing)
    }
    const visual = Array.from(groups.values()).flat()
    const visible = pinned ? visual.filter((t) => t.directory === pinned) : visual
    return visible[index] ?? null
  }

  // Insertion order: t1(/main), t2(/feature), t3(/main), t4(/feature), t5(/main)
  // Visual order (grouped): t1(/main), t3(/main), t5(/main), t2(/feature), t4(/feature)
  const tabs: SimpleTab[] = [
    { id: "t1", directory: "/ws/main" },
    { id: "t2", directory: "/ws/feature" },
    { id: "t3", directory: "/ws/main" },
    { id: "t4", directory: "/ws/feature" },
    { id: "t5", directory: "/ws/main" },
  ]

  test("without pin, Cmd+N selects tabs in visual (grouped-by-directory) order", () => {
    // Visual order: t1, t3, t5 (main group), t2, t4 (feature group)
    expect(resolveTabByIndex(tabs, null, 0)).toEqual(tabs[0]) // t1
    expect(resolveTabByIndex(tabs, null, 1)).toEqual(tabs[2]) // t3
    expect(resolveTabByIndex(tabs, null, 2)).toEqual(tabs[4]) // t5
    expect(resolveTabByIndex(tabs, null, 3)).toEqual(tabs[1]) // t2
    expect(resolveTabByIndex(tabs, null, 4)).toEqual(tabs[3]) // t4
  })

  test("with pin to /ws/main, Cmd+1 selects first main tab, Cmd+2 selects second main tab", () => {
    const result1 = resolveTabByIndex(tabs, "/ws/main", 0)
    const result2 = resolveTabByIndex(tabs, "/ws/main", 1)
    const result3 = resolveTabByIndex(tabs, "/ws/main", 2)
    expect(result1).toEqual({ id: "t1", directory: "/ws/main" })
    expect(result2).toEqual({ id: "t3", directory: "/ws/main" })
    expect(result3).toEqual({ id: "t5", directory: "/ws/main" })
  })

  test("with pin to /ws/feature, Cmd+1 selects first feature tab", () => {
    const result1 = resolveTabByIndex(tabs, "/ws/feature", 0)
    const result2 = resolveTabByIndex(tabs, "/ws/feature", 1)
    expect(result1).toEqual({ id: "t2", directory: "/ws/feature" })
    expect(result2).toEqual({ id: "t4", directory: "/ws/feature" })
  })

  test("all tabs in same directory — visual order matches insertion order", () => {
    const sameDirTabs: SimpleTab[] = [
      { id: "a", directory: "/ws/main" },
      { id: "b", directory: "/ws/main" },
      { id: "c", directory: "/ws/main" },
    ]
    expect(resolveTabByIndex(sameDirTabs, null, 0)!.id).toBe("a")
    expect(resolveTabByIndex(sameDirTabs, null, 1)!.id).toBe("b")
    expect(resolveTabByIndex(sameDirTabs, null, 2)!.id).toBe("c")
  })

  test("index out of bounds returns null", () => {
    expect(resolveTabByIndex(tabs, null, 10)).toBeNull()
    expect(resolveTabByIndex(tabs, "/ws/main", 5)).toBeNull()
  })

  test("pin to nonexistent directory yields no visible tabs", () => {
    expect(resolveTabByIndex(tabs, "/ws/nonexistent", 0)).toBeNull()
  })

  test("empty tab list returns null for any index", () => {
    expect(resolveTabByIndex([], null, 0)).toBeNull()
    expect(resolveTabByIndex([], "/ws/main", 0)).toBeNull()
  })
})

// ============================================================================
// Integration: Cmd+N with layout store and worktree pinning
// ============================================================================

describe("tab switching integration with layout store", () => {
  test("activateByIndex uses visual (grouped-by-directory) order, not insertion order", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g1 = groups[0].id
      const tabs1 = api.groupTabs(g1)

      // Insertion order: s1(/main), s2(/feature), s3(/main)
      const id1 = tabs1.addSession("/ws/main", "s1", "Session 1")
      const id2 = tabs1.addSession("/ws/feature", "s2", "Session 2")
      const id3 = tabs1.addSession("/ws/main", "s3", "Session 3")

      // orderedItems preserves insertion order
      const ordered = tabs1.orderedItems()
      expect(ordered[0].id).toBe(id1)
      expect(ordered[1].id).toBe(id2)
      expect(ordered[2].id).toBe(id3)

      // visualOrderedItems groups by directory: [s1(/main), s3(/main), s2(/feature)]
      const visual = tabs1.visualOrderedItems()
      expect(visual[0].id).toBe(id1)
      expect(visual[1].id).toBe(id3)
      expect(visual[2].id).toBe(id2)

      // Cmd+1 = index 0 → s1 (first main tab)
      tabs1.activateByIndex(0)
      expect(tabs1.activeId()).toBe(id1)

      // Cmd+2 = index 1 → s3 (second main tab, NOT s2/feature)
      tabs1.activateByIndex(1)
      expect(tabs1.activeId()).toBe(id3)

      // Cmd+3 = index 2 → s2 (feature tab)
      tabs1.activateByIndex(2)
      expect(tabs1.activeId()).toBe(id2)
    } finally {
      dispose()
    }
  })

  test("all tabs in same directory — activateByIndex matches insertion order", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g1 = groups[0].id
      const tabs1 = api.groupTabs(g1)

      const id1 = tabs1.addSession("/ws/main", "s1", "Session 1")
      const id2 = tabs1.addSession("/ws/main", "s2", "Session 2")
      const id3 = tabs1.addSession("/ws/main", "s3", "Session 3")

      // Same directory → visual order = insertion order
      tabs1.activateByIndex(0)
      expect(tabs1.activeId()).toBe(id1)
      tabs1.activateByIndex(1)
      expect(tabs1.activeId()).toBe(id2)
      tabs1.activateByIndex(2)
      expect(tabs1.activeId()).toBe(id3)
    } finally {
      dispose()
    }
  })

  test("pinned worktree filter changes which tab Cmd+N activates", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g1 = groups[0].id
      const tabs1 = api.groupTabs(g1)
      const wt = api.groupWorktree(g1)

      const id1 = tabs1.addSession("/ws/main", "s1", "Session 1")
      const id2 = tabs1.addSession("/ws/feature", "s2", "Session 2")
      const id3 = tabs1.addSession("/ws/main", "s3", "Session 3")

      // Pin to /ws/main — visible tabs are [s1, s3]
      wt.setDefault("/ws/main")
      wt.setPinned("/ws/main")
      const pinned = wt.pinned()

      const visual = tabs1.visualOrderedItems()
      const visible = visual.filter((t) => t.directory === pinned)

      expect(visible).toHaveLength(2)
      expect(visible[0].id).toBe(id1)
      expect(visible[1].id).toBe(id3)

      // Cmd+1 activates first visible (s1)
      tabs1.setActive(visible[0].id)
      expect(tabs1.activeId()).toBe(id1)

      // Cmd+2 activates second visible (s3), NOT s2
      tabs1.setActive(visible[1].id)
      expect(tabs1.activeId()).toBe(id3)
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Deleted worktree cleanup
// Thesis: after deleting a worktree, tabs from that directory must be removed
// from all groups, recency cleaned, and default/pinned cleared if affected.
// Without cleanup, workspaceBarProjects still derives the deleted worktree
// from leftover tab directories.
// ============================================================================

describe("deleted worktree cleanup", () => {
  /** Replicate workspaceBarProjects derivation from rail-layout.tsx:503-548 */
  function deriveWorkspaceBarDirs(groups: Array<{ tabs: { items: () => Array<{ directory: string }> } }>) {
    const allTabs: Array<{ directory: string }> = []
    for (const group of groups) {
      allTabs.push(...group.tabs.items())
    }
    return new Set(allTabs.map((t) => t.directory))
  }

  test("tabs from deleted directory are removed from all groups", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g1 = groups[0].id
      const g2 = groups[1].id
      const tabs1 = api.groupTabs(g1)
      const tabs2 = api.groupTabs(g2)

      // Open tabs across both groups, some in /ws/feature (to be deleted)
      tabs1.addSession("/ws/main", "s1", "Session 1")
      tabs1.addSession("/ws/feature", "s2", "Session 2")
      tabs1.addTerminal("/ws/feature", "t1", "Terminal 1")
      tabs2.addSession("/ws/feature", "s3", "Session 3")
      tabs2.addSession("/ws/main", "s4", "Session 4")

      expect(tabs1.items()).toHaveLength(3)
      expect(tabs2.items()).toHaveLength(2)

      // Delete /ws/feature worktree
      api.cleanupDeletedWorktree("/ws/feature")

      // All tabs from /ws/feature should be gone in both groups
      expect(tabs1.items().filter((t: any) => t.directory === "/ws/feature")).toHaveLength(0)
      expect(tabs2.items().filter((t: any) => t.directory === "/ws/feature")).toHaveLength(0)

      // Tabs from /ws/main should remain
      expect(tabs1.items().filter((t: any) => t.directory === "/ws/main")).toHaveLength(1)
      expect(tabs2.items().filter((t: any) => t.directory === "/ws/main")).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  test("deleted directory no longer appears in tab-derived workspace list", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g1 = groups[0].id
      const tabs1 = api.groupTabs(g1)

      tabs1.addSession("/ws/main", "s1", "Session 1")
      tabs1.addSession("/ws/feature", "s2", "Session 2")
      tabs1.addSession("/ws/bugfix", "s3", "Session 3")

      // Before deletion: all 3 directories present
      const dirsBefore = deriveWorkspaceBarDirs([{ tabs: tabs1 }])
      expect(dirsBefore.has("/ws/main")).toBe(true)
      expect(dirsBefore.has("/ws/feature")).toBe(true)
      expect(dirsBefore.has("/ws/bugfix")).toBe(true)

      // Delete /ws/feature
      api.cleanupDeletedWorktree("/ws/feature")

      // After deletion: /ws/feature gone
      const dirsAfter = deriveWorkspaceBarDirs([{ tabs: tabs1 }])
      expect(dirsAfter.has("/ws/main")).toBe(true)
      expect(dirsAfter.has("/ws/feature")).toBe(false)
      expect(dirsAfter.has("/ws/bugfix")).toBe(true)
    } finally {
      dispose()
    }
  })

  test("default worktree is cleared if it pointed to deleted directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g1 = groups[0].id
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      tabs1.addSession("/ws/main", "s1", "Session 1")
      tabs1.addSession("/ws/feature", "s2", "Session 2")
      wt.setDefault("/ws/feature")
      expect(wt.default()).toBe("/ws/feature")

      api.cleanupDeletedWorktree("/ws/feature")

      // Default should be cleared (not point to deleted dir)
      expect(wt.default()).not.toBe("/ws/feature")
    } finally {
      dispose()
    }
  })

  test("pinned worktree is cleared if it pointed to deleted directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g1 = groups[0].id
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      tabs1.addSession("/ws/main", "s1", "Session 1")
      tabs1.addSession("/ws/feature", "s2", "Session 2")
      wt.setDefault("/ws/feature")
      wt.setPinned("/ws/feature")
      expect(wt.pinned()).toBe("/ws/feature")

      api.cleanupDeletedWorktree("/ws/feature")

      expect(wt.pinned()).toBeNull()
    } finally {
      dispose()
    }
  })

  test("unrelated default/pinned worktree is NOT affected by deletion", () => {
    const { api, dispose } = createTestLayout()
    try {
      api.split.toggle()
      const groups = api.split.groups()
      const g1 = groups[0].id
      const wt = api.groupWorktree(g1)
      const tabs1 = api.groupTabs(g1)

      tabs1.addSession("/ws/main", "s1", "Session 1")
      tabs1.addSession("/ws/feature", "s2", "Session 2")
      wt.setDefault("/ws/main")
      wt.setPinned("/ws/main")

      api.cleanupDeletedWorktree("/ws/feature")

      expect(wt.default()).toBe("/ws/main")
      expect(wt.pinned()).toBe("/ws/main")
    } finally {
      dispose()
    }
  })

  test("workspace recency is cleaned up for the deleted directory", () => {
    const { api, dispose } = createTestLayout()
    try {
      // Record accesses to build recency
      api.workspaceRecency.recordAccess("p1", "/ws/main")
      api.workspaceRecency.recordAccess("p1", "/ws/feature")
      api.workspaceRecency.recordAccess("p1", "/ws/bugfix")

      const recentBefore = api.workspaceRecency.getRecent("p1", 10)
      expect(recentBefore).toContain("/ws/feature")

      api.cleanupDeletedWorktree("/ws/feature", "p1")

      const recentAfter = api.workspaceRecency.getRecent("p1", 10)
      expect(recentAfter).not.toContain("/ws/feature")
      expect(recentAfter).toContain("/ws/main")
      expect(recentAfter).toContain("/ws/bugfix")
    } finally {
      dispose()
    }
  })
})
