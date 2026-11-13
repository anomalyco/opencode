import { describe, expect, test } from "bun:test"
import { sidebarView, type SidebarRow, type SidebarViewState } from "./sidebar-view"

function row(overrides: Partial<SidebarRow> & { key: string }): SidebarRow {
  return {
    server: "a",
    projectID: "p1",
    open: true,
    active: false,
    parentKey: undefined,
    status: "idle",
    updated: 0,
    created: 0,
    order: 0,
    ...overrides,
  }
}

function state(overrides: Partial<SidebarViewState> = {}): SidebarViewState {
  return {
    grouping: "none",
    ordering: "manual",
    show: { recent: true, subagents: true, serverLabels: false },
    filters: { status: [], server: [], project: [] },
    collapsed: {},
    ...overrides,
  }
}

const keys = (rows: SidebarRow[], input: SidebarViewState) =>
  sidebarView(rows, input).groups.flatMap((group) => group.rows.map((item) => item.key))

describe("sidebarView", () => {
  const ordering = [
    row({ key: "open-late", order: 2, updated: 50, created: 1, status: "running" }),
    row({ key: "open-early", order: 1, updated: 10, created: 5, status: "failed" }),
    row({ key: "recent-new", open: false, updated: 100, created: 3, status: "input" }),
    row({ key: "recent-old", open: false, updated: 20, created: 9, status: "idle" }),
  ]

  test.each([
    ["manual", ["open-early", "open-late", "recent-new", "recent-old"]],
    ["updated", ["open-late", "open-early", "recent-new", "recent-old"]],
    ["created", ["open-early", "open-late", "recent-old", "recent-new"]],
    ["attention", ["open-early", "open-late", "recent-new", "recent-old"]],
  ] as const)("orders open rows before recent ones by %s", (mode, expected) => {
    expect(keys(ordering, state({ ordering: mode }))).toEqual([...expected])
  })

  test("attention ranks status before recency and breaks ties by updated", () => {
    const rows = [
      row({ key: "idle", status: "idle", updated: 9 }),
      row({ key: "unread-old", status: "unread", updated: 1 }),
      row({ key: "unread-new", status: "unread", updated: 5 }),
      row({ key: "input", status: "input", updated: 0 }),
    ]

    expect(keys(rows, state({ ordering: "attention" }))).toEqual(["input", "unread-new", "unread-old", "idle"])
  })

  test("merges a project across servers in project grouping and splits it per server", () => {
    const rows = [
      row({ key: "a1", server: "a", projectID: "p1", order: 0 }),
      row({ key: "b1", server: "b", projectID: "p1", order: 1 }),
      row({ key: "b-none", server: "b", projectID: undefined, order: 2 }),
      row({ key: "a2", server: "a", projectID: "p2", order: 3 }),
    ]

    const project = sidebarView(rows, state({ grouping: "project" })).groups
    expect(project.map((group) => [group.key, group.spansServers, group.rows.map((item) => item.key)])).toEqual([
      ["project:p1", true, ["a1", "b1"]],
      ["project:p2", false, ["a2"]],
      ["project:other", false, ["b-none"]],
    ])

    const nested = sidebarView(rows, state({ grouping: "server-project" })).groups
    expect(
      nested.map((group) => [group.key, group.open, group.rows, group.children?.map((child) => child.key)]),
    ).toEqual([
      ["server:a", 2, [], ["server:a/project:p1", "server:a/project:p2"]],
      ["server:b", 2, [], ["server:b/project:p1", "server:b/project:other"]],
    ])
    expect(nested[1]?.children?.map((child) => [child.server, child.spansServers])).toEqual([
      ["b", false],
      ["b", false],
    ])
  })

  test("other project group stays last even when it holds the first row", () => {
    const rows = [row({ key: "none", projectID: undefined, order: 0 }), row({ key: "p", projectID: "p9", order: 1 })]
    expect(sidebarView(rows, state({ grouping: "project" })).groups.map((group) => group.key)).toEqual([
      "project:p9",
      "project:other",
    ])
  })

  test("places subagents after their parent in the parent's group and drops orphans", () => {
    const rows = [
      row({ key: "parent", order: 1, projectID: "p1" }),
      row({ key: "other", order: 0, projectID: "p2" }),
      row({ key: "sub-old", open: false, parentKey: "parent", projectID: "p2", updated: 1 }),
      row({ key: "sub-new", open: false, parentKey: "parent", projectID: undefined, updated: 5 }),
      row({ key: "grandchild", open: false, parentKey: "sub-old", updated: 0 }),
      row({ key: "orphan", open: false, parentKey: "missing" }),
      row({ key: "orphan-child", open: false, parentKey: "orphan" }),
    ]

    const groups = sidebarView(rows, state({ grouping: "project" })).groups
    expect(groups.map((group) => [group.key, group.open, group.rows.map((item) => item.key)])).toEqual([
      ["project:p2", 1, ["other"]],
      ["project:p1", 1, ["parent", "sub-new", "sub-old", "grandchild"]],
    ])
  })

  test("keeps an active orphan subagent as a top-level row", () => {
    const rows = [row({ key: "open", order: 0 }), row({ key: "sub", open: false, parentKey: "gone", active: true })]
    expect(keys(rows, state())).toEqual(["open", "sub"])
  })

  const matched = ["match", "active", "recent"]

  test.each<[string, Partial<SidebarViewState>, string[]]>([
    ["status filter", { filters: { status: ["running"], server: [], project: [] } }, matched],
    ["server filter", { filters: { status: [], server: ["b"], project: [] } }, matched],
    ["project filter", { filters: { status: [], server: [], project: ["none"] } }, matched],
    ["hidden recent", { show: { recent: false, subagents: true, serverLabels: false } }, ["match", "miss", "active"]],
  ])("%s drops non-matching rows but keeps the active row", (_, overrides, expected) => {
    const rows = [
      row({ key: "active", open: false, active: true }),
      row({ key: "match", server: "b", projectID: undefined, status: "running" }),
      row({ key: "recent", open: false, server: "b", projectID: undefined, status: "running" }),
      row({ key: "miss", status: "idle" }),
    ]

    expect(keys(rows, state({ ordering: "updated", ...overrides }))).toEqual(expected)
  })

  test("project filter keeps rows of the named project", () => {
    const rows = [row({ key: "p1" }), row({ key: "p2", projectID: "p2" })]
    expect(keys(rows, state({ filters: { status: [], server: [], project: ["p2"] } }))).toEqual(["p2"])
  })

  test("hides subagent rows unless shown", () => {
    const rows = [row({ key: "parent" }), row({ key: "sub", open: false, parentKey: "parent" })]

    const hidden = { recent: true, subagents: false, serverLabels: false }
    expect(keys(rows, state({ show: hidden }))).toEqual(["parent"])
    expect(keys(rows, state({ show: { ...hidden, subagents: true } }))).toEqual(["parent", "sub"])
  })

  test("collapsed groups hide their open keys but keep the active row", () => {
    const rows = [
      row({ key: "a1", server: "a", projectID: "p1", order: 0 }),
      row({ key: "a2", server: "a", projectID: "p2", order: 1 }),
      row({ key: "b1", server: "b", projectID: "p1", order: 2 }),
      row({ key: "b2", server: "b", projectID: "p2", order: 3, active: true }),
      row({ key: "c1", server: "c", projectID: "p1", order: 4 }),
    ]

    const view = sidebarView(
      rows,
      state({
        grouping: "server-project",
        collapsed: { "server:a/project:p2": true, "server:b": true, "server:c": true },
      }),
    )

    expect(view.groups.map((group) => [group.key, group.collapsed, group.children?.length])).toEqual([
      ["server:a", false, 2],
      ["server:b", true, 2],
      ["server:c", true, 1],
    ])
    expect(view.groups[0]?.children?.map((child) => child.collapsed)).toEqual([false, true])

    const flat = sidebarView(
      rows,
      state({ grouping: "project", collapsed: { "project:p1": true, "project:p2": true } }),
    )

    expect(flat.groups.map((group) => [group.key, group.collapsed])).toEqual([
      ["project:p1", true],
      ["project:p2", true],
    ])
  })
})
