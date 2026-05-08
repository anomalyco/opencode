import { describe, expect, test } from "bun:test"
import { DateTime } from "luxon"
import { type GlobalSession } from "@opencode-ai/sdk/v2/client"
import { flattenRecentRoots, organizeRecentSessions, recentPrefix } from "./recent-session"

const session = (
  input: Partial<GlobalSession> &
    Pick<GlobalSession, "id" | "title" | "directory"> & {
      time: { created: number; updated: number; archived?: number }
    },
) =>
  ({
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    summary: undefined,
    project: null,
    ...input,
  }) as GlobalSession

describe("recent session helpers", () => {
  test("formats a root folder and worktree prefix", () => {
    expect(
      recentPrefix(
        session({
          id: "root",
          title: "Root",
          directory: "/repo/project-one",
          project: { id: "p1", name: "Project One", worktree: "/repo/project-one" },
          time: { created: 1, updated: 1 },
        }),
      ),
    ).toBe("project-one")

    expect(
      recentPrefix(
        session({
          id: "wt",
          title: "Sandbox",
          directory: "/tmp/worktree/project-one-2026-03-27-14-05",
          project: { id: "p1", name: "Project One", worktree: "/repo/project-one" },
          time: { created: 1, updated: 1 },
        }),
      ),
    ).toBe("project-one / project-one-2026-03-27-14-05")
  })

  test("orders roots by the newest descendant activity", () => {
    const now = DateTime.local(2026, 3, 28, 10, 0, 0)
    const root = session({
      id: "root",
      title: "Root",
      directory: "/repo/app",
      project: { id: "p1", name: "App", worktree: "/repo/app" },
      time: { created: 1, updated: DateTime.local(2026, 3, 20, 9, 0, 0).toMillis() },
    })
    const child = session({
      id: "child",
      title: "Child",
      directory: "/repo/app",
      parentID: "root",
      project: { id: "p1", name: "App", worktree: "/repo/app" },
      time: { created: 1, updated: DateTime.local(2026, 3, 28, 9, 0, 0).toMillis() },
    })
    const other = session({
      id: "other",
      title: "Other",
      directory: "/repo/other",
      project: { id: "p2", name: "Other", worktree: "/repo/other" },
      time: { created: 1, updated: DateTime.local(2026, 3, 27, 8, 0, 0).toMillis() },
    })

    const data = organizeRecentSessions([child, other, root], now)

    expect(data.sections.map((item) => item.label)).toEqual(["Today", "Yesterday"])
    expect(data.sections[0]?.items.map((item) => item.id)).toEqual(["root"])
    expect(data.sections[1]?.items.map((item) => item.id)).toEqual(["other"])

    expect(
      flattenRecentRoots({
        roots: data.sections[0]?.items ?? [],
        lookup: data.lookup,
        children: data.children,
      }),
    ).toEqual([
      { session: root, depth: 0 },
      { session: child, depth: 1 },
    ])
  })

  test("orphan children with missing parent are excluded from sections", () => {
    const now = DateTime.local(2026, 3, 28, 10, 0, 0)
    const orphan = session({
      id: "orphan",
      title: "Orphan",
      directory: "/repo/app",
      parentID: "missing-parent",
      project: { id: "p1", name: "App", worktree: "/repo/app" },
      time: { created: 1, updated: DateTime.local(2026, 3, 28, 9, 0, 0).toMillis() },
    })
    const root = session({
      id: "root",
      title: "Root",
      directory: "/repo/app",
      project: { id: "p1", name: "App", worktree: "/repo/app" },
      time: { created: 1, updated: DateTime.local(2026, 3, 27, 8, 0, 0).toMillis() },
    })

    const data = organizeRecentSessions([orphan, root], now)

    expect(data.roots.map((s) => s.id)).toEqual(["root"])
    expect(data.sections.map((s) => s.label)).toEqual(["Yesterday"])
  })

  test("orphan-only list produces empty sections", () => {
    const now = DateTime.local(2026, 3, 28, 10, 0, 0)
    const orphan = session({
      id: "orphan",
      title: "Orphan",
      directory: "/repo/app",
      parentID: "missing",
      project: { id: "p1", name: "App", worktree: "/repo/app" },
      time: { created: 1, updated: now.toMillis() },
    })

    const data = organizeRecentSessions([orphan], now)

    expect(data.roots).toEqual([])
    expect(data.sections.length).toBe(0)
  })
})
