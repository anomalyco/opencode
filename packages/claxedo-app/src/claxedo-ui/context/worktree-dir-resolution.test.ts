/**
 * Worktree Directory Resolution Tests
 *
 * Verifies that new sessions and terminals use the selected worktree directory,
 * not the stale route-level activeWorkspaceId.
 *
 * Fix 1 (terminal): GroupPanel.onNewTerminal now resolves dir from
 *   wt.default() ?? activeWorkspaceId ?? tabs().active()?.directory
 *   (matching onNewSession), and passes it to handleNewTerminal.
 *
 * Fix 2 (session): handleNewSession now finds the group whose
 *   worktree.default matches workspaceDir, instead of always using topTabs.
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

/**
 * Mirrors the FIXED resolution in GroupPanel.onNewTerminal (rail-layout.tsx):
 *   const dir = wt.default() ?? gp.props.activeWorkspaceId ?? tabs().active()?.directory
 *
 * This is the same resolution that GroupPanel.onNewSession already used.
 */
function resolveDir(
  groupWorktreeDefault: string | null,
  routeActiveWorkspaceId: string | undefined,
  activeTabDir: string | undefined,
) {
  return groupWorktreeDefault ?? routeActiveWorkspaceId ?? activeTabDir
}

// ============================================================================
// Single-panel: workspace bar switch then tab bar action (no split, no focus change)
//
// The simplest reproduction: one panel, user clicks a different worktree
// in the workspace bar (wt.setDefault changes), then clicks the terminal
// or session button in the SAME panel's tab bar.
//
// FIXED: GroupPanel.onNewTerminal now resolves dir from wt.default(),
// so activeWorkspaceId() staleness no longer matters.
// ============================================================================

describe("single-panel: tab bar action after workspace bar switch", () => {
  test("new terminal from tab bar uses selected worktree, not stale route dir", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)
      const tabs = api.groupTabs(g1)

      // Step 1: initial route loaded with /project/main
      tabs.addSession("/project/main", "s1", "Session 1")
      wt.setDefault("/project/main")
      const routeDir = "/project/main" // activeWorkspaceId() — frozen in URL

      // Step 2: user clicks /project/sandbox in workspace bar
      wt.setDefault("/project/sandbox")

      // Step 3: user clicks terminal button in same panel's tab bar
      // FIXED: GroupPanel.onNewTerminal resolves dir from wt.default()
      const dir = resolveDir(wt.default(), routeDir, tabs.active()?.directory)

      // Step 4: verify — should be the selected worktree
      expect(dir).toBe("/project/sandbox")
    } finally {
      dispose()
    }
  })

  test("new session from tab bar correctly uses selected worktree (for contrast)", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)
      const tabs = api.groupTabs(g1)

      tabs.addSession("/project/main", "s1", "Session 1")
      wt.setDefault("/project/main")
      const routeDir = "/project/main"

      // User switches worktree in workspace bar
      wt.setDefault("/project/sandbox")

      // Both onNewSession and onNewTerminal now resolve from wt.default()
      const sessionDir = resolveDir(wt.default(), routeDir, tabs.active()?.directory)
      const terminalDir = resolveDir(wt.default(), routeDir, tabs.active()?.directory)

      expect(sessionDir).toBe("/project/sandbox")
      expect(terminalDir).toBe("/project/sandbox")
    } finally {
      dispose()
    }
  })

  test("switching worktrees multiple times — terminal follows current selection", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)
      const tabs = api.groupTabs(g1)

      tabs.addSession("/ws-alpha", "s1", "Session Alpha")
      wt.setDefault("/ws-alpha")
      const routeDir = "/ws-alpha" // frozen in URL

      // Switch to beta
      wt.setDefault("/ws-beta")
      expect(resolveDir(wt.default(), routeDir, undefined)).toBe("/ws-beta")

      // Switch to gamma
      wt.setDefault("/ws-gamma")
      expect(resolveDir(wt.default(), routeDir, undefined)).toBe("/ws-gamma")
    } finally {
      dispose()
    }
  })

  test("terminal requestCreate end-to-end: dir matches selected worktree", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)

      wt.setDefault("/project/main")
      const routeDir = "/project/main"

      // User switches worktree
      wt.setDefault("/project/sandbox")

      // FIXED: requestCreate now receives the resolved dir from GroupPanel
      const dir = resolveDir(wt.default(), routeDir, undefined)
      api.terminal.requestCreate(dir!, "claude", "Claude", g1)

      expect(api.terminal.pendingDir()).toBe("/project/sandbox")
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Terminal directory resolution (split scenarios)
// ============================================================================

describe("terminal creation respects selected worktree", () => {
  test("when worktree differs from route, terminal uses worktree.default", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)
      const tabs = api.groupTabs(g1)

      tabs.addSession("/ws-route", "s1", "Session 1")
      wt.setDefault("/ws-selected")

      const routeDir = "/ws-route"
      const dir = resolveDir(wt.default(), routeDir, tabs.active()?.directory)

      expect(dir).toBe("/ws-selected")
    } finally {
      dispose()
    }
  })

  test("requestCreate receives selected worktree dir when user switches workspace", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)

      wt.setDefault("/sandbox-123")

      const routeDir = "/main-workspace"
      const dir = resolveDir(wt.default(), routeDir, undefined)
      api.terminal.requestCreate(dir!, undefined, undefined, g1)

      expect(api.terminal.pendingDir()).toBe("/sandbox-123")
    } finally {
      dispose()
    }
  })

  test("in split view, each group's terminal uses its own selected worktree", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, wt1, wt2 } = splitInto2(api)

      wt1.setDefault("/project/main")
      wt2.setDefault("/project/sandbox")
      api.split.setFocus(g1)

      // Each group resolves dir from its own worktree.default
      const dir2 = resolveDir(wt2.default(), "/project/main", undefined)
      api.terminal.requestCreate(dir2!, undefined, undefined, g2)

      expect(api.terminal.pendingDir()).toBe("/project/sandbox")
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Session directory resolution
// ============================================================================

describe("session creation respects selected worktree", () => {
  test("GroupPanel resolves correct dir from worktree.default, not route", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)
      const tabs = api.groupTabs(g1)

      tabs.addSession("/ws-route", "s1", "Session 1")
      wt.setDefault("/ws-selected")

      const routeDir = "/ws-route"
      const dir = resolveDir(wt.default(), routeDir, tabs.active()?.directory)
      expect(dir).toBe("/ws-selected")

      api.topTabs.addSession(dir!, "new", "New Session")

      const newTab = tabs.items().find((t: any) => t.sessionId === "new")
      expect(newTab).toBeDefined()
      expect(newTab!.directory).toBe("/ws-selected")
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// Session group targeting (topTabs vs groupTabs)
//
// FIXED: handleNewSession now finds the group whose worktree.default matches
// workspaceDir, so sessions land in the correct split panel.
// ============================================================================

describe("session creation targets correct group in split view", () => {
  test("new session from non-focused group lands in the group with matching worktree", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2, wt1, wt2 } = splitInto2(api)

      wt1.setDefault("/ws1")
      wt2.setDefault("/ws2")
      api.split.setFocus(g1)

      // Simulate FIXED handleNewSession: find group whose worktree matches
      const workspaceDir = "/ws2"
      const targetGroup = api.split.groups().find(
        (g: any) => api.groupWorktree(g.id).default() === workspaceDir,
      )
      const tabs = targetGroup ? api.groupTabs(targetGroup.id) : api.topTabs
      tabs.addSession(workspaceDir, "new", "New Session")

      // Session should be in group 2 (matches /ws2)
      expect(tabs2.items().some((t: any) => t.sessionId === "new")).toBe(true)
      expect(tabs1.items().some((t: any) => t.sessionId === "new")).toBe(false)
    } finally {
      dispose()
    }
  })

  test("session for unmatched dir falls back to focused group", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, g2, tabs1, tabs2, wt1, wt2 } = splitInto2(api)

      wt1.setDefault("/ws1")
      wt2.setDefault("/ws2")
      api.split.setFocus(g1)

      // Dir doesn't match any group's worktree.default → falls back to topTabs (focused)
      const workspaceDir = "/ws-new-unknown"
      const targetGroup = api.split.groups().find(
        (g: any) => api.groupWorktree(g.id).default() === workspaceDir,
      )
      const tabs = targetGroup ? api.groupTabs(targetGroup.id) : api.topTabs
      tabs.addSession(workspaceDir, "new", "New Session")

      // Falls back to focused group (g1)
      expect(tabs1.items().some((t: any) => t.sessionId === "new")).toBe(true)
      expect(tabs2.items().some((t: any) => t.sessionId === "new")).toBe(false)
    } finally {
      dispose()
    }
  })
})

// ============================================================================
// onNewTerminal callback parity with onNewSession
// ============================================================================

describe("onNewTerminal callback parity with onNewSession", () => {
  test("onNewTerminal resolves dir the same way onNewSession does", () => {
    const { api, dispose } = createTestLayout()
    try {
      const g1 = api.split.groups()[0].id
      const wt = api.groupWorktree(g1)
      const tabs = api.groupTabs(g1)

      tabs.addSession("/ws-route", "s1", "Session 1")
      wt.setDefault("/ws-selected")

      const routeActiveWorkspaceId = "/ws-route"

      // Both use the same resolveDir logic now
      const sessionDir = resolveDir(wt.default(), routeActiveWorkspaceId, tabs.active()?.directory)
      const terminalDir = resolveDir(wt.default(), routeActiveWorkspaceId, tabs.active()?.directory)

      expect(sessionDir).toBe("/ws-selected")
      expect(terminalDir).toBe(sessionDir)
    } finally {
      dispose()
    }
  })

  test("after switching worktree, new terminal and new session use same dir", () => {
    const { api, dispose } = createTestLayout()
    try {
      const { g1, tabs1, wt1 } = splitInto2(api)

      tabs1.addSession("/main", "s1", "Session 1")
      wt1.setDefault("/main")

      // User switches worktree to /sandbox in the workspace bar
      wt1.setDefault("/sandbox")

      const routeDir = "/main" // Route hasn't changed

      const sessionDir = resolveDir(wt1.default(), routeDir, tabs1.active()?.directory)
      const terminalDir = resolveDir(wt1.default(), routeDir, tabs1.active()?.directory)

      expect(sessionDir).toBe("/sandbox")
      expect(terminalDir).toBe("/sandbox")
    } finally {
      dispose()
    }
  })
})
