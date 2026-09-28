import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import type { LocalProject } from "@/shell/state/layout"
import { buildHomeProjectUnion, buildHomeRecentlyClosed } from "./union"

const project = (id: string, worktree: string, extra: Partial<LocalProject> = {}) =>
  ({ id, worktree, expanded: true, ...extra }) as LocalProject

const session = (id: string, input: Partial<SessionInfo> = {}) =>
  ({
    id,
    projectID: "project",
    title: id,
    time: { created: 1, updated: 1 },
    location: { directory: "/repo" },
    ...input,
  }) as SessionInfo

const enrich = (input: { worktree: string; expanded: boolean }) =>
  ({ id: `enriched:${input.worktree}`, worktree: input.worktree, expanded: input.expanded }) as LocalProject

const plainEnrich = (input: { worktree: string; expanded: boolean }) =>
  ({ worktree: input.worktree, expanded: input.expanded }) as LocalProject

describe("buildHomeProjectUnion order client>db>orphan", () => {
  test("preserves client order then db then orphan", () => {
    const result = buildHomeProjectUnion({
      client: [project("c1", "/c1")],
      db: [project("db1", "/db1")],
      sessions: [session("o1", { projectID: "orphan1", location: { directory: "/orphan1" } })],
      enrich: plainEnrich,
    })
    expect(result.map((item) => item.id)).toEqual(["c1", "db1", "orphan1"])
    expect(result.map((item) => item.worktree)).toEqual(["/c1", "/db1", "/orphan1"])
  })

  test("union never deletes client or DB rows", () => {
    const result = buildHomeProjectUnion({
      client: [project("c1", "/c1"), project("shared", "/shared")],
      db: [project("shared", "/shared"), project("db1", "/db1")],
      sessions: [],
      enrich: plainEnrich,
    })
    expect(result.map((item) => item.id)).toEqual(["c1", "shared", "db1"])
  })
})

describe("buildHomeProjectUnion ID-only dedupe", () => {
  test("keeps CustomerOrderManagement distinct from _v3", () => {
    const result = buildHomeProjectUnion({
      client: [
        project("com", "/mnt/Meta/Projects/DotNET/VisualStudio2026/CustomerOrderManagement"),
        project("com-v3", "/mnt/Meta/Projects/DotNET/VisualStudio2026/CustomerOrderManagement_v3"),
      ],
      db: [project("com", "/mnt/Meta/Projects/DotNET/VisualStudio2026/CustomerOrderManagement")],
      sessions: [],
      enrich: plainEnrich,
    })
    expect(result.map((item) => item.id)).toEqual(["com", "com-v3"])
  })

  test("keeps Rememory distinct from Rememory2", () => {
    const result = buildHomeProjectUnion({
      client: [project("rem", "/mnt/Meta/Projects/DotNET/VisualStudio2026/Rememory")],
      db: [project("rem2", "/mnt/Meta/Projects/DotNET/VisualStudio2026/Rememory2")],
      sessions: [],
      enrich: plainEnrich,
    })
    expect(result.map((item) => item.id)).toEqual(["rem", "rem2"])
  })

  test("collapses exact duplicate IDs preserving first order", () => {
    const result = buildHomeProjectUnion({
      client: [project("b", "/b"), project("a", "/a")],
      db: [project("b", "/b2")],
      sessions: [],
      enrich: plainEnrich,
    })
    expect(result.map((item) => item.id)).toEqual(["b", "a"])
    expect(result[0]?.worktree).toBe("/b")
  })
})

describe("buildHomeProjectUnion alias second-pass", () => {
  test("E:/ plus /mnt collapse to one row by alias", () => {
    const result = buildHomeProjectUnion({
      client: [project("go", "/mnt/Meta/Projects/Go/mcpproxy-go")],
      db: [project("go-dup", "E:/Projects/Go/mcpproxy-go")],
      sessions: [],
      enrich: plainEnrich,
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe("go")
  })

  test("orphan directory alias-matching existing project confers no new row", () => {
    const result = buildHomeProjectUnion({
      client: [project("go", "/mnt/Meta/Projects/Go/mcpproxy-go")],
      db: [],
      sessions: [session("w", { projectID: "go", location: { directory: "E:/Projects/Go/mcpproxy-go" } })],
      enrich: plainEnrich,
    })
    expect(result.map((item) => item.id)).toEqual(["go"])
  })

  test("orphan with unknown ID synthesizes a row preserving projectID", () => {
    const result = buildHomeProjectUnion({
      client: [],
      db: [],
      sessions: [session("o", { projectID: "orphan-id", location: { directory: "/repo/orphan" } })],
      enrich: plainEnrich,
    })
    expect(result.map((item) => item.id)).toContain("orphan-id")
    expect(result[0]?.worktree).toBe("/repo/orphan")
  })

  test("archived and child sessions do not confer orphans", () => {
    const result = buildHomeProjectUnion({
      client: [],
      db: [],
      sessions: [
        session("arch", {
          projectID: "p-arch",
          location: { directory: "/repo/arch" },
          time: { created: 1, updated: 1, archived: 2 },
        }),
        session("child", { projectID: "p-child", parentID: "root", location: { directory: "/repo/child" } }),
      ],
      enrich: plainEnrich,
    })
    expect(result).toEqual([])
  })
})

describe("buildHomeProjectUnion enrich reuse", () => {
  test("db rows flow through enrich so icon overrides stay consistent", () => {
    const seen: string[] = []
    const result = buildHomeProjectUnion({
      client: [],
      db: [project("db1", "/db1")],
      sessions: [],
      enrich: (input) => {
        seen.push(input.worktree)
        return enrich(input)
      },
    })
    expect(seen).toEqual(["/db1"])
    expect(result[0]?.id).toBe("enriched:/db1")
  })

  test("orphan rows reuse enrich and keep session projectID on miss", () => {
    const result = buildHomeProjectUnion({
      client: [],
      db: [],
      sessions: [session("o", { projectID: "orphan-id", location: { directory: "/repo/orphan" } })],
      enrich: plainEnrich,
    })
    expect(result[0]?.id).toBe("orphan-id")
  })
})

describe("buildHomeRecentlyClosed filtered limit 5", () => {
  test("filters to DB-known worktrees and caps at 5", () => {
    const closed = ["/a", "/b", "/c", "/d", "/e", "/f", "/unknown"]
    const known = ["/a", "/b", "/c", "/d", "/e", "/f"].map((worktree) => ({ worktree }))
    const result = buildHomeRecentlyClosed({ closed, known, enrich: plainEnrich })
    expect(result.map((item) => item.worktree)).toEqual(["/a", "/b", "/c", "/d", "/e"])
  })

  test("drops closed paths no longer known", () => {
    const result = buildHomeRecentlyClosed({
      closed: ["/gone", "/kept"],
      known: [{ worktree: "/kept" }],
      enrich: plainEnrich,
    })
    expect(result.map((item) => item.worktree)).toEqual(["/kept"])
  })
})
