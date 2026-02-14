/**
 * Cross-Group Panel Session Targeting
 *
 * Specs under test:
 * 1. New sessions from the "+" button appear in the requesting (focused) group.
 * 2. Empty split groups remain empty until the user explicitly creates a session.
 * 3. Session directory matches the group's worktree.default, not the route URL.
 *
 * The bugs live in component-level logic (ClaxedoLayoutContent auto-create
 * effect and handleNewSession group resolution), so these tests exercise the
 * resolution contracts through minimal helpers rather than full component
 * rendering. Each helper mirrors one decision point:
 *
 *   resolveSessionTarget — which group receives the new session?
 *   shouldAutoCreate     — should an empty focused group get a session?
 */
import { beforeAll, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { ensureLayoutMocked, getInitLayout } from "./_test-helper"

let initLayout: () => any

beforeAll(async () => {
  await ensureLayoutMocked()
  initLayout = getInitLayout()
})

function setup() {
  let dispose!: () => void
  const api = createRoot((d) => {
    dispose = d
    return initLayout()
  })
  return { api, dispose }
}

// ---------------------------------------------------------------------------
// Resolution helpers — contract wrappers, not implementation copies.
// ---------------------------------------------------------------------------

/**
 * Contract: given a workspace directory, resolve which group should receive
 * the new session.  When multiple groups share the same worktree.default the
 * focused group should win.
 *
 * Mirrors ClaxedoLayout handleNewSession (line 590-593).
 */
function resolveSessionTarget(api: any, workspaceDir: string): string | undefined {
  return api.split.groups().find(
    (g: any) => api.groupWorktree(g.id).default() === workspaceDir,
  )?.id
}

/**
 * Contract: the system should NOT auto-create a session for an intentionally
 * empty split group that just received focus.
 *
 * Mirrors ClaxedoLayoutContent auto-create guard (line 331-338).
 */
function shouldAutoCreate(api: any, routeDir: string | undefined): boolean {
  if (!routeDir) return false
  if (api.topTabs.activeId()) return false
  return true
}

// ---------------------------------------------------------------------------
// Shared setup: primary panel with one session, then split into two groups.
// ---------------------------------------------------------------------------

function setupSplit(api: any, primaryDir = "/ws-main") {
  const g1 = api.split.groups()[0].id
  api.groupTabs(g1).addSession(primaryDir, "s1", "Session 1")
  api.groupWorktree(g1).setDefault(primaryDir)

  api.split.toggle()
  const g2 = api.split.groups()[1].id
  // secondary inherits primaryDir from defaultForNewGroup()

  return { g1, g2 }
}

// ===========================================================================
// 1. New session targets the requesting (focused) group
// ===========================================================================

describe("new session targets requesting group", () => {
  test("resolves to focused group when both groups share same worktree", () => {
    const { api, dispose } = setup()
    try {
      const { g1, g2 } = setupSplit(api)
      api.split.setFocus(g2)

      // Both groups have /ws-main — resolution should prefer focused group.
      const target = resolveSessionTarget(api, "/ws-main")
      expect(target).toBe(g2)
    } finally {
      dispose()
    }
  })

  test("creates session in focused secondary, not primary", () => {
    const { api, dispose } = setup()
    try {
      const { g1, g2 } = setupSplit(api)
      api.split.setFocus(g2)

      // Perform the full resolution + creation (handleNewSession path).
      const target = resolveSessionTarget(api, "/ws-main")
      const tabs = target ? api.groupTabs(target) : api.topTabs
      tabs.addSession("/ws-main", "new", "New Session")

      expect(api.groupTabs(g2).findSession("/ws-main", "new")).toBeDefined()
      expect(api.groupTabs(g1).findSession("/ws-main", "new")).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test("resolves correctly when groups have distinct worktrees", () => {
    const { api, dispose } = setup()
    try {
      const { g1, g2 } = setupSplit(api)
      api.groupWorktree(g2).setDefault("/ws-sandbox")
      api.split.setFocus(g2)

      // Different worktrees — find() returns the correct match.
      const target = resolveSessionTarget(api, "/ws-sandbox")
      expect(target).toBe(g2)

      api.groupTabs(g2).addSession("/ws-sandbox", "new", "New Session")
      expect(api.groupTabs(g2).findSession("/ws-sandbox", "new")).toBeDefined()
    } finally {
      dispose()
    }
  })
})

// ===========================================================================
// 2. Empty split groups stay empty until explicit creation
// ===========================================================================

describe("empty split group stays empty until explicit creation", () => {
  test("does not auto-create session when empty group receives focus", () => {
    const { api, dispose } = setup()
    try {
      const { g2 } = setupSplit(api)
      api.split.setFocus(g2)

      // The auto-create guard should block for intentionally empty split groups.
      expect(shouldAutoCreate(api, "/ws-main")).toBe(false)
    } finally {
      dispose()
    }
  })

})

// ===========================================================================
// 3. Session directory matches group worktree, not route URL
// ===========================================================================

describe("session directory matches group worktree", () => {
  test("uses group worktree for session directory, not route URL", () => {
    const { api, dispose } = setup()
    try {
      const { g2 } = setupSplit(api)
      api.groupWorktree(g2).setDefault("/ws-sandbox")
      api.split.setFocus(g2)

      // If the system creates a session, the directory must come from the
      // group's worktree.default, not activeWorkspaceId (route URL).
      const fired = shouldAutoCreate(api, "/ws-main")

      if (fired) {
        // Current code fires and uses the route dir — assert correct dir.
        api.topTabs.addSession("/ws-main", "new", "New Session")
        const tab = api.groupTabs(g2).findSession("/ws-main", "new")
          ?? api.groupTabs(g2).findSession("/ws-sandbox", "new")
        expect(tab).toBeDefined()
        expect(tab!.directory).toBe("/ws-sandbox")
      } else {
        // Correct behaviour — no auto-create at all.
        expect(api.groupTabs(g2).items()).toHaveLength(0)
      }
    } finally {
      dispose()
    }
  })

  test("secondary with distinct worktree gets session with correct directory", () => {
    const { api, dispose } = setup()
    try {
      const { g2 } = setupSplit(api)
      api.groupWorktree(g2).setDefault("/project/feature")
      api.split.setFocus(g2)

      // Explicitly create session — directory must match the group's worktree.
      const groupDir = api.groupWorktree(g2).default()!
      api.topTabs.addSession(groupDir, "new", "New Session")

      const tab = api.groupTabs(g2).findSession("/project/feature", "new")
      expect(tab).toBeDefined()
      expect(tab!.directory).toBe("/project/feature")
    } finally {
      dispose()
    }
  })
})

// ===========================================================================
// 4. Combined: targeting + directory when both bugs interact
// ===========================================================================

describe("combined targeting and directory", () => {
  test("only focused secondary gets new session when '+' clicked with shared worktree", () => {
    const { api, dispose } = setup()
    try {
      const { g1, g2 } = setupSplit(api)
      api.split.setFocus(g2)

      // Step 1 — focus fires auto-create (if guard lets it through).
      if (shouldAutoCreate(api, "/ws-main")) {
        api.topTabs.addSession("/ws-main", "new", "New Session")
      }

      // Step 2 — user clicks "+" in secondary.
      const target = resolveSessionTarget(api, "/ws-main")
      const tabs = target ? api.groupTabs(target) : api.topTabs
      tabs.addSession("/ws-main", "new", "New Session")

      // Only the focused group should have the new session.
      const g1New = api.groupTabs(g1).findSession("/ws-main", "new")
      const g2New = api.groupTabs(g2).findSession("/ws-main", "new")
      expect(g2New).toBeDefined()
      expect(g1New).toBeUndefined()
    } finally {
      dispose()
    }
  })
})
