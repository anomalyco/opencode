import { expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { tabKey, type Tab } from "@/shell/tabs/tabs"
import { autoTabGroups, groupedTabOrder, type AutoTabGroupItem } from "./auto-tab-groups"

const A = ServerConnection.Key.make("http://127.0.0.1:4096")

const B = ServerConnection.Key.make("http://127.0.0.1:4097")

const item = (server: ServerConnection.Key, id: string, project: string | undefined): AutoTabGroupItem => ({
  tab: { type: "session", server, sessionId: id },
  server,
  project,
})

const ids = (tabs: Tab[]) => tabs.map((tab) => (tab.type === "session" ? tab.sessionId : tab.draftID))

const group = (
  items: AutoTabGroupItem[],
  options: { grouping?: "project" | "server"; collapsed?: string[]; current?: Tab } = {},
) =>
  autoTabGroups({
    grouping: options.grouping ?? "project",
    servers: 2,
    items,
    collapsed: Object.fromEntries((options.collapsed ?? []).map((key) => [key, true])),
    current: options.current,
  })

test("groups follow their first tab, and tabs with no project come last", () => {
  const groups = group([item(A, "1", undefined), item(A, "2", "web"), item(A, "3", "api"), item(A, "4", "web")])

  expect(groups?.map((value) => [value.kind, value.project, ids(value.tabs)])).toEqual([
    ["project", "web", ["2", "4"]],
    ["project", "api", ["3"]],
    ["other", undefined, ["1"]],
  ])
})

test("the same project on two servers is two groups that both say so", () => {
  const groups = group([item(A, "1", "web"), item(B, "2", "web"), item(A, "3", "api")])

  expect(groups?.map((value) => [value.server, value.project, value.spansServers])).toEqual([
    [A, "web", true],
    [B, "web", true],
    [A, "api", false],
  ])
})

test("grouping by server needs a second server", () => {
  const items = [item(A, "1", "web"), item(B, "2", "web")]

  expect(group(items, { grouping: "server" })?.map((value) => ids(value.tabs))).toEqual([["1"], ["2"]])
  expect(autoTabGroups({ grouping: "server", servers: 1, items, collapsed: {}, current: undefined })).toBeUndefined()
  expect(autoTabGroups({ grouping: "none", servers: 2, items, collapsed: {}, current: undefined })).toBeUndefined()
})

test("a collapsed group shows only the current tab", () => {
  const items = [item(A, "1", "web"), item(A, "2", "web"), item(A, "3", "api")]
  const web = group(items)![0].key

  expect(group(items, { collapsed: [web] })?.map((value) => ids(value.tabs))).toEqual([[], ["3"]])
  expect(group(items, { collapsed: [web], current: { ...items[1].tab } })?.map((value) => ids(value.tabs))).toEqual([
    ["2"],
    ["3"],
  ])
})

test("grouping brings each group's tabs together and leaves other tabs in place", () => {
  const items = [item(A, "a1", "web"), item(A, "b1", "api"), item(A, "o1", undefined), item(A, "a2", "web")]
  const pinned = tabKey({ type: "session", server: A, sessionId: "p1" })
  const key = (id: string) => tabKey({ type: "session", server: A, sessionId: id })
  const order = [key("a1"), pinned, key("b1"), key("o1"), key("a2")]

  expect(groupedTabOrder(order, group(items)!)).toEqual([key("a1"), pinned, key("a2"), key("o1"), key("b1")])
})
