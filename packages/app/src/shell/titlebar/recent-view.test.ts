import { describe, expect, test } from "bun:test"
import { DEFAULT_RECENT_VIEW, recentGroups, type RecentView, type RecentViewRow } from "./recent-view"

const now = new Date(2026, 10, 18, 15).getTime()

const day = 24 * 60 * 60 * 1000

function row(key: string, input: Partial<RecentViewRow> = {}): RecentViewRow {
  return {
    key,
    title: key,
    updated: now,
    created: now,
    status: "read",
    project: undefined,
    server: "local",
    ...input,
  }
}

const context = {
  now,
  servers: [
    { key: "local", label: "This computer" },
    { key: "remote", label: "Remote" },
  ],
}

const view = (input: Partial<RecentView>) => ({ ...DEFAULT_RECENT_VIEW, ...input })

const membership = (groups: ReturnType<typeof recentGroups>) =>
  groups.map((group) => [group.id, group.rows.map((item) => item.key)])

describe("recentGroups", () => {
  test("none lists every row in one group, newest first", () => {
    const groups = recentGroups(
      [row("a", { updated: now - 2 }), row("b", { updated: now - 1 })],
      DEFAULT_RECENT_VIEW,
      context,
    )

    expect(membership(groups)).toEqual([["all", ["b", "a"]]])
  })

  test("sorts by name and creation in either direction", () => {
    const rows = [row("b", { created: now - 1 }), row("a", { created: now - 2 }), row("c", { created: now - 3 })]

    expect(membership(recentGroups(rows, view({ sortBy: "name", direction: "asc" }), context))).toEqual([
      ["all", ["a", "b", "c"]],
    ])
    expect(membership(recentGroups(rows, view({ sortBy: "created" }), context))).toEqual([["all", ["b", "a", "c"]]])
  })

  test("date groups follow the sort direction and hide empty ones unless asked", () => {
    const rows = [row("old", { updated: now - 40 * day }), row("today"), row("yesterday", { updated: now - day })]

    expect(membership(recentGroups(rows, view({ groupBy: "date" }), context))).toEqual([
      ["today", ["today"]],
      ["yesterday", ["yesterday"]],
      ["older", ["old"]],
    ])
    expect(
      recentGroups(rows, view({ groupBy: "date", direction: "asc", emptyGroups: true }), context).map((g) => g.id),
    ).toEqual(["older", "week", "yesterday", "today"])
  })

  test("status groups keep their fixed order whatever the sort", () => {
    const rows = [row("read"), row("working", { status: "working" }), row("attention", { status: "attention" })]

    expect(membership(recentGroups(rows, view({ groupBy: "status", direction: "asc" }), context))).toEqual([
      ["attention", ["attention"]],
      ["working", ["working"]],
      ["read", ["read"]],
    ])
  })

  test("project groups go A to Z with sessions outside a project last", () => {
    const rows = [
      row("loose"),
      row("z", { project: { key: "local:/z", label: "zeta" } }),
      row("a", { project: { key: "local:/a", label: "alpha" } }),
    ]

    expect(membership(recentGroups(rows, view({ groupBy: "project", emptyGroups: true }), context))).toEqual([
      ["local:/a", ["a"]],
      ["local:/z", ["z"]],
      ["none", ["loose"]],
    ])
  })

  test("server groups follow the server order and can show empty servers", () => {
    const rows = [row("r", { server: "remote" })]

    expect(membership(recentGroups(rows, view({ groupBy: "server", emptyGroups: true }), context))).toEqual([
      ["local", []],
      ["remote", ["r"]],
    ])
  })
})
