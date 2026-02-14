/**
 * Terminal Navigate + Tab Scroll Tests
 *
 * Fix 1 (terminal navigate): handleNewTerminal must navigate() before
 *   requestCreate() so the route-level TerminalContentWrapperInner's
 *   sdk.directory matches pendingDir(). Without the navigate, a workspace-bar
 *   worktree switch leaves the URL (and sdk.directory) stale, causing the
 *   pendingDir !== dir() check to silently drop the request.
 *
 * Fix 2 (tab scroll): TopTabBar now watches tabs().activeId() and calls
 *   scrollIntoView on the [data-tab-id] element. These tests verify the
 *   underlying activeId tracking that drives the scroll effect.
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
    wt1: api.groupWorktree(g1),
    wt2: api.groupWorktree(g2),
  }
}

// ============================================================================
// Fix 1: handleNewTerminal must navigate before requestCreate
//
// The route-level TerminalContentWrapperInner checks:
//   if (pendingDir() !== dir()) return   // dir() = sdk.directory from URL
//
// Without navigate(), workspace-bar switches leave pendingDir ≠ dir(),
// silently dropping the terminal creation request.
// ============================================================================

describe("terminal pending create: route dir must match pendingDir", () => {
  /**
   * Simulates the TerminalContentWrapperInner's consumption check.
   * Returns true if the create would be consumed (dir matches),
   * false if it would be silently dropped.
   */
  function wouldBeConsumed(pendingDir: string | undefined, routeDir: string) {
    if (!pendingDir) return false
    return pendingDir === routeDir
  }

  test("pendingDir matches route dir → create is consumable (fixed path)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)

      wt.setDefault("/project/main")

      // User switches worktree in workspace bar
      wt.setDefault("/project/sandbox")

      // FIXED: handleNewTerminal navigates to /project/sandbox first,
      // then calls requestCreate with that same dir.
      const resolvedDir = wt.default()!
      const navigatedRouteDir = resolvedDir // navigate() updates URL → sdk.directory
      api.terminal.requestCreate(resolvedDir, "claude", "Claude", g1)

      // The wrapper's check: pendingDir() === dir()
      expect(wouldBeConsumed(api.terminal.pendingDir(), navigatedRouteDir)).toBe(true)
    } finally {
      dispose()
    }
  })

  test("pendingDir differs from stale route dir → create is dropped (the bug)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)

      wt.setDefault("/project/main")
      const staleRouteDir = "/project/main" // URL not updated

      // User switches worktree in workspace bar
      wt.setDefault("/project/sandbox")

      // requestCreate uses the selected worktree dir
      api.terminal.requestCreate(wt.default()!, "claude", "Claude", g1)

      // Without navigate, routeDir is still stale → mismatch → dropped
      expect(api.terminal.pendingDir()).toBe("/project/sandbox")
      expect(wouldBeConsumed(api.terminal.pendingDir(), staleRouteDir)).toBe(false)
    } finally {
      dispose()
    }
  })

  test("consumePendingCommand returns correct command, title, and groupId", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id

      api.terminal.requestCreate("/ws", "claude --dangerously-skip-permissions", "Claude", g1)

      const consumed = api.terminal.consumePendingCommand()
      expect(consumed.directory).toBe("/ws")
      expect(consumed.command).toBe("claude --dangerously-skip-permissions")
      expect(consumed.title).toBe("Claude")
      expect(consumed.groupId).toBe(g1)
    } finally {
      dispose()
    }
  })

  test("after consumption, pendingCreate is decremented", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id

      api.terminal.requestCreate("/ws", "claude", "Claude", g1)
      expect(api.terminal.pendingCreate()).toBe(1)

      api.terminal.consumePendingCommand()
      expect(api.terminal.pendingCreate()).toBe(0)
      expect(api.terminal.pendingDir()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("multiple queued creates are consumed in order", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id

      api.terminal.requestCreate("/ws1", "cmd1", "T1", g1)
      api.terminal.requestCreate("/ws2", "cmd2", "T2", g1)

      expect(api.terminal.pendingCreate()).toBe(2)
      expect(api.terminal.pendingDir()).toBe("/ws1")

      const first = api.terminal.consumePendingCommand()
      expect(first.directory).toBe("/ws1")
      expect(first.command).toBe("cmd1")
      expect(first.title).toBe("T1")
      expect(api.terminal.pendingCreate()).toBe(1)

      const second = api.terminal.consumePendingCommand()
      expect(second.directory).toBe("/ws2")
      expect(second.command).toBe("cmd2")
      expect(second.title).toBe("T2")
      expect(api.terminal.pendingCreate()).toBe(0)
    } finally {
      dispose()
    }
  })

  test("clearPendingCreate wipes all queued creates", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id

      api.terminal.requestCreate("/ws1", "cmd1", "T1", g1)
      api.terminal.requestCreate("/ws2", "cmd2", "T2", g1)
      expect(api.terminal.pendingCreate()).toBe(2)

      api.terminal.clearPendingCreate()
      expect(api.terminal.pendingCreate()).toBe(0)
      expect(api.terminal.pendingDir()).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("requestCreate with plain terminal (no command/title)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id

      api.terminal.requestCreate("/ws")
      expect(api.terminal.pendingDir()).toBe("/ws")

      const consumed = api.terminal.consumePendingCommand()
      expect(consumed.directory).toBe("/ws")
      expect(consumed.command).toBeUndefined()
      expect(consumed.title).toBeUndefined()
      expect(consumed.groupId).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("split view: requestCreate uses group-specific resolved dir, not route dir", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, wt1, wt2 } = splitInto2(api)

      wt1.setDefault("/main")
      wt2.setDefault("/sandbox")
      api.split.setFocus(g1)

      const staleRouteDir = "/main" // URL reflects focused group

      // User clicks terminal button in group 2's tab bar.
      // GroupPanel resolves dir from wt2.default(), not the route.
      const resolvedDir = wt2.default()!
      api.terminal.requestCreate(resolvedDir, undefined, undefined, g2)

      // pendingDir is /sandbox (from group 2's worktree), not /main
      expect(api.terminal.pendingDir()).toBe("/sandbox")
      // Would be consumed only after navigate updates routeDir
      expect(wouldBeConsumed(api.terminal.pendingDir(), staleRouteDir)).toBe(false)
      expect(wouldBeConsumed(api.terminal.pendingDir(), resolvedDir)).toBe(true)
    } finally {
      dispose()
    }
  })

  test("creatingGroupId is set correctly for group-scoped creates", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g2 } = splitInto2(api)

      api.terminal.requestCreate("/sandbox", "claude", "Claude", g2)
      expect(api.terminal.creatingGroupId()).toBe(g2)
      expect(api.terminal.creating()).toBeGreaterThan(0)
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Fix 2: Tab bar scroll — activeId tracking
//
// TopTabBar now watches tabs().activeId() and scrolls the corresponding
// [data-tab-id] element into view. These tests verify that activeId is
// correctly updated when tabs are added, switched, or closed — the
// prerequisite for the scroll effect to fire.
// ============================================================================

describe("activeId tracking for tab scroll", () => {
  test("addSession sets the new tab as active", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const tabs = api.groupTabs(g1)

      const id = tabs.addSession("/ws", "s1", "Session 1")
      expect(tabs.activeId()).toBe(id)
    } finally {
      dispose()
    }
  })

  test("addTerminal sets the new tab as active", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const tabs = api.groupTabs(g1)

      const id = tabs.addTerminal("/ws", "pty-1", "Terminal")
      expect(tabs.activeId()).toBe(id)
    } finally {
      dispose()
    }
  })

  test("adding many tabs: last added is always active", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const tabs = api.groupTabs(g1)

      // Simulate many tabs being added (tab bar would overflow visually)
      const ids: string[] = []
      for (let i = 0; i < 20; i++) {
        const id = tabs.addSession("/ws", `s${i}`, `Session ${i}`)
        ids.push(id)
      }

      // The last tab added should be active
      expect(tabs.activeId()).toBe(ids[ids.length - 1])
      // All 20 tabs should exist
      expect(tabs.items()).toHaveLength(20)
    } finally {
      dispose()
    }
  })

  test("setActive changes activeId (triggers scroll effect)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const tabs = api.groupTabs(g1)

      const id1 = tabs.addSession("/ws", "s1", "Session 1")
      const id2 = tabs.addSession("/ws", "s2", "Session 2")
      const id3 = tabs.addSession("/ws", "s3", "Session 3")

      expect(tabs.activeId()).toBe(id3) // last added

      tabs.setActive(id1)
      expect(tabs.activeId()).toBe(id1)

      tabs.setActive(id2)
      expect(tabs.activeId()).toBe(id2)
    } finally {
      dispose()
    }
  })

  test("closing active tab moves activeId to neighbor (triggers scroll)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const tabs = api.groupTabs(g1)

      const id1 = tabs.addSession("/ws", "s1", "Session 1")
      const id2 = tabs.addSession("/ws", "s2", "Session 2")
      const id3 = tabs.addSession("/ws", "s3", "Session 3")

      tabs.setActive(id2)
      expect(tabs.activeId()).toBe(id2)

      tabs.close(id2)
      // After closing, activeId should move to a neighbor
      const activeId = tabs.activeId()
      expect(activeId).not.toBe(id2)
      expect([id1, id3]).toContain(activeId)
    } finally {
      dispose()
    }
  })

  test("terminal tab added after many sessions: activeId points to terminal", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const tabs = api.groupTabs(g1)

      // Add several session tabs first
      for (let i = 0; i < 10; i++) {
        tabs.addSession("/ws", `s${i}`, `Session ${i}`)
      }

      // Add a terminal tab (would be at the end, off-screen)
      const termId = tabs.addTerminal("/ws", "pty-1", "Claude")
      expect(tabs.activeId()).toBe(termId)

      // The terminal tab should be in the items list
      const termTab = tabs.items().find((t: any) => t.id === termId)
      expect(termTab).toBeDefined()
      expect(termTab!.type).toBe("terminal")
    } finally {
      dispose()
    }
  })

  test("mixed directory tabs: activeId updates even across worktree groups", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const tabs = api.groupTabs(g1)

      // Tabs across two different directories
      const s1 = tabs.addSession("/ws-a", "s1", "A: Session 1")
      const s2 = tabs.addSession("/ws-b", "s2", "B: Session 1")
      const s3 = tabs.addSession("/ws-a", "s3", "A: Session 2")
      const t1 = tabs.addTerminal("/ws-b", "pty-1", "B: Terminal")

      expect(tabs.activeId()).toBe(t1) // last added

      // Switch to an earlier tab in different directory
      tabs.setActive(s1)
      expect(tabs.activeId()).toBe(s1)

      // Switch back to the terminal
      tabs.setActive(t1)
      expect(tabs.activeId()).toBe(t1)
    } finally {
      dispose()
    }
  })

  test("split view: each group tracks its own activeId independently", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2 } = splitInto2(api)

      const a1 = tabs1.addSession("/ws1", "s1", "Group1 Session")
      const a2 = tabs2.addSession("/ws2", "s2", "Group2 Session")

      // Each group has its own activeId
      expect(tabs1.activeId()).toBe(a1)
      expect(tabs2.activeId()).toBe(a2)

      // Add more tabs to group 1
      const a3 = tabs1.addSession("/ws1", "s3", "Group1 Session 2")
      expect(tabs1.activeId()).toBe(a3)
      expect(tabs2.activeId()).toBe(a2) // group 2 unchanged

      // Add terminal to group 2
      const t1 = tabs2.addTerminal("/ws2", "pty-1", "Terminal")
      expect(tabs2.activeId()).toBe(t1)
      expect(tabs1.activeId()).toBe(a3) // group 1 unchanged
    } finally {
      dispose()
    }
  })

  test("activateNext/activatePrevious cycle through tabs correctly", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const tabs = api.groupTabs(g1)

      const id1 = tabs.addSession("/ws", "s1", "Session 1")
      const id2 = tabs.addSession("/ws", "s2", "Session 2")
      const id3 = tabs.addSession("/ws", "s3", "Session 3")

      tabs.setActive(id1)
      expect(tabs.activeId()).toBe(id1)

      tabs.activateNext()
      expect(tabs.activeId()).toBe(id2)

      tabs.activateNext()
      expect(tabs.activeId()).toBe(id3)

      tabs.activatePrevious()
      expect(tabs.activeId()).toBe(id2)
    } finally {
      dispose()
    }
  })
})
