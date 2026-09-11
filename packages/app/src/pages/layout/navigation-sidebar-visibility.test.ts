import { describe, expect, test } from "bun:test"
import { type Session } from "@opencode-ai/sdk/v2/client"
import type { LocalProject } from "@/context/layout"
import {
  buildSidebarRecords,
  groupSidebarRecords,
  matchesSidebarFilter,
  partitionSidebarRecords,
  SIDEBAR_SESSION_DAY,
} from "./navigation-sidebar-visibility"

const session = (input: Partial<Session> & Pick<Session, "id" | "directory">) =>
  ({
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
  }) as Session

const project = (worktree: string): LocalProject =>
  ({ worktree, expanded: false, id: worktree, name: worktree.split("/").pop() }) as LocalProject

const DAY = SIDEBAR_SESSION_DAY
const NOW = 100 * DAY

describe("navigation sidebar visibility", () => {
  test("buildSidebarRecords keeps only root sessions inside project directories", () => {
    const projects = [project("/src/a"), project("/src/b")]
    const records = buildSidebarRecords({
      projects,
      sessions: [
        session({ id: "1", directory: "/src/a", time: { created: 10, updated: 20, archived: undefined } }),
        session({ id: "2", directory: "/src/other" }),
        session({ id: "3", directory: "/src/a", parentID: "1" }),
        session({ id: "1", directory: "/src/a", time: { created: 10, updated: 30, archived: undefined } }),
      ],
    })
    expect(records).toHaveLength(1)
    expect(records[0]?.session.id).toBe("1")
  })

  test("groupSidebarRecords groups records by project worktree", () => {
    const projects = [project("/src/a"), project("/src/b")]
    const groups = groupSidebarRecords(
      buildSidebarRecords({
        projects,
        sessions: [
          session({ id: "1", directory: "/src/a", time: { created: 1, updated: 5, archived: undefined } }),
          session({ id: "2", directory: "/src/b", time: { created: 1, updated: 9, archived: undefined } }),
          session({ id: "3", directory: "/src/a", time: { created: 1, updated: 2, archived: undefined } }),
        ],
      }),
    )
    expect(groups.map((group) => group.key)).toEqual(["/src/b", "/src/a"])
    expect(groups[0]?.records.map((record) => record.session.id)).toEqual(["2"])
    expect(groups[1]?.records.map((record) => record.session.id)).toEqual(["1", "3"])
  })

  test("partitions by age while keeping pinned records visible", () => {
    const fresh = session({ id: "fresh", directory: "/src/a", time: { created: NOW - DAY, updated: NOW - DAY, archived: undefined } })
    const stale = session({ id: "stale", directory: "/src/a", time: { created: NOW - 10 * DAY, updated: NOW - 10 * DAY, archived: undefined } })
    const staleWorking = session({ id: "working", directory: "/src/a", time: { created: NOW - 10 * DAY, updated: NOW - 10 * DAY, archived: undefined } })
    const result = partitionSidebarRecords({
      records: [
        { session: fresh, project: project("/src/a"), name: "a" },
        { session: stale, project: project("/src/a"), name: "a" },
        { session: staleWorking, project: project("/src/a"), name: "a" },
      ],
      pinned: (record) => record.session.id === "working",
      days: 3,
      now: NOW,
    })
    expect(result.visible.map((record) => record.session.id)).toEqual(["fresh", "working"])
    expect(result.hidden.map((record) => record.session.id)).toEqual(["stale"])
  })

  test("days of zero keeps every session visible", () => {
    const ancient = session({ id: "ancient", directory: "/src/a", time: { created: 0, updated: 0, archived: undefined } })
    const result = partitionSidebarRecords({
      records: [{ session: ancient, project: project("/src/a"), name: "a" }],
      pinned: () => false,
      days: 0,
      now: NOW,
    })
    expect(result.visible).toHaveLength(1)
    expect(result.hidden).toHaveLength(0)
  })

  test("matchesSidebarFilter checks project name and session title", () => {
    const record = {
      session: session({ id: "1", directory: "/src/a", title: "Fix login bug" }),
      project: project("/src/a"),
      name: "Web App",
    }
    expect(matchesSidebarFilter(record, "")).toBe(true)
    expect(matchesSidebarFilter(record, "web")).toBe(true)
    expect(matchesSidebarFilter(record, "login")).toBe(true)
    expect(matchesSidebarFilter(record, "missing")).toBe(false)
  })
})
