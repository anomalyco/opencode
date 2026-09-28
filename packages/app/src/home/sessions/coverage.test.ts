import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import {
  PROJECT_LIST_DEFAULT_LIMIT,
  PROJECT_LIST_MAX_PAGES,
  collectProjectCoverage,
  dedupeProjectsByID,
  isCoverageSession,
  isOrphanSession,
  unionSessionLists,
  walkSessionPages,
  type CoverageProject,
} from "./coverage"

const session = (id: string, input: Partial<SessionInfo> = {}) =>
  ({
    id,
    projectID: "project",
    title: id,
    time: { created: 1, updated: 1 },
    location: { directory: "/repo" },
    ...input,
  }) as SessionInfo

const project = (id: string, worktree: string) => ({ id, worktree, expanded: false }) as CoverageProject

describe("T3 project.list coverage inclusion", () => {
  test("empty project with zero sessions still appears", () => {
    const result = collectProjectCoverage({
      clientProjects: [],
      dbProjects: [project("empty", "/repo/empty")],
      sessions: [],
    })
    expect(result.projects.map((item) => item.id)).toEqual(["empty"])
    expect(result.counts["empty"]).toBe(0)
  })

  test("archived sessions do not confer coverage", () => {
    expect(isCoverageSession(session("a", { time: { created: 1, updated: 1, archived: 2 } }))).toBe(false)
  })

  test("child sessions do not confer coverage", () => {
    expect(isCoverageSession(session("c", { parentID: "root" }))).toBe(false)
  })

  test("global-project roots confer coverage", () => {
    expect(isCoverageSession(session("g", { projectID: "global" }))).toBe(true)
  })

  test("live roots confer coverage", () => {
    expect(isCoverageSession(session("r"))).toBe(true)
  })

  test("archived/children/global matrix through collect", () => {
    const result = collectProjectCoverage({
      clientProjects: [],
      dbProjects: [],
      sessions: [
        session("live", { projectID: "p-live", location: { directory: "/repo/live" } }),
        session("child", { projectID: "p-child", parentID: "live", location: { directory: "/repo/child" } }),
        session("arch", {
          projectID: "p-arch",
          location: { directory: "/repo/arch" },
          time: { created: 1, updated: 1, archived: 2 },
        }),
        session("glob", { projectID: "global", location: { directory: "/repo/glob" } }),
      ],
    })
    const ids = result.projects.map((item) => item.id)
    expect(ids).toContain("p-live")
    expect(ids).toContain("global")
    expect(ids).not.toContain("p-child")
    expect(ids).not.toContain("p-arch")
  })
})

describe("T3 ID-only dedupe", () => {
  test("keeps CustomerOrderManagement distinct from _v3", () => {
    const rows = dedupeProjectsByID([
      project("com", "/mnt/Meta/Projects/DotNET/VisualStudio2026/CustomerOrderManagement"),
      project("com-v3", "/mnt/Meta/Projects/DotNET/VisualStudio2026/CustomerOrderManagement_v3"),
      project("com", "/mnt/Meta/Projects/DotNET/VisualStudio2026/CustomerOrderManagement"),
    ])
    expect(rows.map((item) => item.id)).toEqual(["com", "com-v3"])
  })

  test("keeps Rememory distinct from Rememory2", () => {
    const rows = dedupeProjectsByID([
      project("rem", "/mnt/Meta/Projects/DotNET/VisualStudio2026/Rememory"),
      project("rem2", "/mnt/Meta/Projects/DotNET/VisualStudio2026/Rememory2"),
    ])
    expect(rows.map((item) => item.id)).toEqual(["rem", "rem2"])
  })

  test("keeps Go proxy distinct from Rust proxy", () => {
    const rows = dedupeProjectsByID([
      project("go", "/mnt/Meta/Projects/Go/mcpproxy-go"),
      project("rust", "/mnt/Meta/Projects/Rust/mcp-proxy"),
    ])
    expect(rows.map((item) => item.id)).toEqual(["go", "rust"])
  })

  test("collapses exact duplicate IDs preserving first order", () => {
    const rows = dedupeProjectsByID([project("b", "/b"), project("a", "/a"), project("b", "/b2")])
    expect(rows.map((item) => item.id)).toEqual(["b", "a"])
    expect(rows[0]?.worktree).toBe("/b")
  })

  test("union never deletes client or DB rows", () => {
    const result = collectProjectCoverage({
      clientProjects: [project("c1", "/c1"), project("shared", "/shared")],
      dbProjects: [project("shared", "/shared"), project("db1", "/db1")],
      sessions: [],
    })
    expect(result.projects.map((item) => item.id)).toEqual(["c1", "shared", "db1"])
  })
})

describe("T3 dual-spelling union", () => {
  test("verbatim E:/ plus aliased /mnt union to one session by ID", () => {
    const verbatim = session("w", { projectID: "go", location: { directory: "E:/Projects/Go/mcpproxy-go" } })
    const aliased = session("w", {
      projectID: "go",
      location: { directory: "/mnt/Meta/Projects/Go/mcpproxy-go" },
    })
    expect(unionSessionLists([verbatim], [aliased]).map((item) => item.id)).toEqual(["w"])
  })

  test("distinct IDs survive the union even on the same pathKey", () => {
    const a = session("a", { projectID: "pa", location: { directory: "/repo/x" } })
    const b = session("b", { projectID: "pb", location: { directory: "/repo/x" } })
    expect(unionSessionLists([a], [b]).map((item) => item.id)).toEqual(["a", "b"])
  })

  test("both spellings confer a single project row", () => {
    const result = collectProjectCoverage({
      clientProjects: [],
      dbProjects: [project("go", "/mnt/Meta/Projects/Go/mcpproxy-go")],
      sessions: [
        session("w1", { projectID: "go", location: { directory: "E:/Projects/Go/mcpproxy-go" } }),
        session("w1-dup", { projectID: "go", location: { directory: "E:/Projects/Go/mcpproxy-go" } }),
      ].flatMap((item) =>
        item.id === "w1"
          ? [item, session("w1", { projectID: "go", location: { directory: "/mnt/Meta/Projects/Go/mcpproxy-go" } })]
          : [item],
      ),
    })
    const unioned = unionSessionLists(
      result.sessions.filter((item) => item.location.directory.startsWith("E:")),
      result.sessions.filter((item) => item.location.directory.startsWith("/mnt")),
    )
    expect(new Set(unioned.map((item) => item.id)).size).toBe(unioned.length)
    expect(result.projects.filter((item) => item.id === "go")).toHaveLength(1)
  })
})

describe("T3 orphan directories", () => {
  test("session with unknown project ID is an orphan", () => {
    expect(isOrphanSession(session("o", { projectID: "unknown" }), new Set(["known"]))).toBe(true)
    expect(isOrphanSession(session("k", { projectID: "known" }), new Set(["known"]))).toBe(false)
  })

  test("orphan directory confers a synthesized project row", () => {
    const result = collectProjectCoverage({
      clientProjects: [],
      dbProjects: [],
      sessions: [session("o", { projectID: "orphan-id", location: { directory: "/repo/orphan" } })],
    })
    expect(result.projects.map((item) => item.id)).toContain("orphan-id")
    expect(result.counts["orphan-id"]).toBe(1)
  })
})

describe("T3 pagination walk", () => {
  test("defaults to limit 50", () => {
    expect(PROJECT_LIST_DEFAULT_LIMIT).toBe(50)
  })

  test("empty first page returns no rows and one call", async () => {
    let calls = 0
    const result = await walkSessionPages(async () => {
      calls += 1
      return { data: [], cursor: {} }
    })
    expect(result).toEqual([])
    expect(calls).toBe(1)
  })

  test("exactly 50 rows with no next stops after one page", async () => {
    const all = Array.from({ length: 50 }, (_, index) => session(`s-${index}`))
    let calls = 0
    const result = await walkSessionPages(async () => {
      calls += 1
      return { data: all, cursor: {} }
    })
    expect(result).toHaveLength(50)
    expect(calls).toBe(1)
  })

  test("51 rows walk two pages", async () => {
    const first = Array.from({ length: 50 }, (_, index) => session(`s-${index}`))
    const second = [session("s-50")]
    const result = await walkSessionPages(async (input) => {
      if (!input.cursor) return { data: first, cursor: { next: "n1" } }
      return { data: second, cursor: {} }
    })
    expect(result).toHaveLength(51)
  })

  test("stops when next is missing even on a full page", async () => {
    const full = Array.from({ length: 50 }, (_, index) => session(`s-${index}`))
    let calls = 0
    const result = await walkSessionPages(async () => {
      calls += 1
      return { data: full, cursor: {} }
    })
    expect(result).toHaveLength(50)
    expect(calls).toBe(1)
  })

  test("stops on a repeated cursor", async () => {
    let calls = 0
    const result = await walkSessionPages(
      async () => {
        calls += 1
        return { data: [session(`s-${calls}`)], cursor: { next: "stuck" } }
      },
      { maxPages: 10 },
    )
    expect(calls).toBe(2)
    expect(result).toHaveLength(2)
  })

  test("stops at the page cap", async () => {
    let calls = 0
    const result = await walkSessionPages(
      async () => {
        calls += 1
        return { data: [session(`s-${calls}`)], cursor: { next: `n-${calls}` } }
      },
      { maxPages: 3 },
    )
    expect(calls).toBe(3)
    expect(result).toHaveLength(3)
    expect(PROJECT_LIST_MAX_PAGES).toBeGreaterThan(3)
  })
})
