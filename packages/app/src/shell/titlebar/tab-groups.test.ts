import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { tabKey, type Tab } from "@/shell/tabs/tabs"
import {
  buildComputedTabGroups,
  DEFAULT_TAB_GROUPS_STATE,
  reconcileManualAssignments,
  reorderTabKeysByGroups,
  type ResolvedTabMeta,
  type TabGroupsState,
} from "./tab-groups"

const SERVER_A = ServerConnection.Key.make("http://127.0.0.1:4096")

const SERVER_B = ServerConnection.Key.make("http://127.0.0.1:4097")

function sessionTab(server: ServerConnection.Key, sessionId: string): Tab {
  return { type: "session", server, sessionId }
}

function draftTab(server: ServerConnection.Key, draftID: string, directory = "/work/app"): Tab {
  return { type: "draft", server, draftID, directory }
}

function meta(
  tab: Tab,
  overrides: Partial<Omit<ResolvedTabMeta, "tab" | "key" | "server">> = {},
): ResolvedTabMeta {
  return {
    tab,
    key: tabKey(tab),
    server: tab.server,
    serverLabel: tab.server === SERVER_A ? "local" : "blade",
    title: tab.type === "session" ? tab.sessionId : tab.draftID,
    projectID: "proj_a",
    projectName: "opencode",
    directory: "/work/app",
    status: "idle",
    active: false,
    ...overrides,
  }
}

const labels = {
  other: "Other",
  status: (value: string) => value,
}

describe("tab-groups", () => {
  test("suppresses automatic server grouping until more than one server is connected", () => {
    const a = meta(sessionTab(SERVER_A, "ses_1"), { title: "Alpha" })
    const b = meta(sessionTab(SERVER_A, "ses_2"), { title: "Beta" })

    const singleServer = buildComputedTabGroups({
      items: [a, b],
      state: DEFAULT_TAB_GROUPS_STATE,
      mode: "server",
      serverCount: 1,
      query: "",
      labels,
    })

    expect(singleServer).toBeUndefined()

    const c = meta(sessionTab(SERVER_B, "ses_3"), { title: "Gamma" })

    const multiServer = buildComputedTabGroups({
      items: [a, b, c],
      state: DEFAULT_TAB_GROUPS_STATE,
      mode: "server",
      serverCount: 2,
      query: "",
      labels,
    })

    expect(multiServer?.map((group) => ({ name: group.name, count: group.allTabs.length }))).toEqual([
      { name: "local", count: 2 },
      { name: "blade", count: 1 },
    ])
    expect(multiServer?.[0]?.color).not.toBe(multiServer?.[1]?.color)
  })

  test("renders manual groups inline alongside ungrouped tabs when automatic grouping is none", () => {
    const t1 = sessionTab(SERVER_A, "ses_1")
    const t2 = sessionTab(SERVER_A, "ses_2")
    const t3 = sessionTab(SERVER_A, "ses_3")
    const t4 = sessionTab(SERVER_B, "ses_4")

    const state: TabGroupsState = {
      ...DEFAULT_TAB_GROUPS_STATE,
      mode: "none",
      collapsed: { "manual:g_rel": true },
      manualGroups: [
        { id: "g_ui", name: "Browser UI", color: "purple" },
        { id: "g_rel", name: "Release", color: "pink" },
      ],
      manualAssignments: {
        [tabKey(t2)]: "g_ui",
        [tabKey(t3)]: "g_ui",
        [tabKey(t4)]: "g_rel",
      },
    }

    const groups = buildComputedTabGroups({
      items: [meta(t1), meta(t2), meta(t3), meta(t4)],
      state,
      mode: "none",
      serverCount: 2,
      query: "",
      labels,
    })

    expect(groups?.map((group) => ({ kind: group.kind, name: group.name, visible: group.visibleTabs.length }))).toEqual([
      { kind: "ungrouped", name: "", visible: 1 },
      { kind: "manual", name: "Browser UI", visible: 2 },
      { kind: "manual", name: "Release", visible: 0 },
    ])
  })

  test("migrates manual group membership on draft-to-session promotion and prunes closed keys", () => {
    const draft = draftTab(SERVER_A, "draft_1")
    const promoted = sessionTab(SERVER_A, "ses_promoted")
    const kept = sessionTab(SERVER_A, "ses_kept")
    const closed = sessionTab(SERVER_A, "ses_closed")

    const reconciled = reconcileManualAssignments(
      [tabKey(draft), tabKey(kept), tabKey(closed)],
      [tabKey(promoted), tabKey(kept), tabKey(closed)],
      {
        [tabKey(draft)]: "g_1",
        [tabKey(closed)]: "g_2",
      },
    )

    expect(reconciled).toEqual({
      [tabKey(promoted)]: "g_1",
      [tabKey(closed)]: "g_2",
    })

    const pruned = reconcileManualAssignments([tabKey(promoted), tabKey(closed)], [tabKey(promoted)], reconciled!)
    expect(pruned).toEqual({
      [tabKey(promoted)]: "g_1",
    })
  })

  test("reorders whole groups while preserving tabs inside collapsed groups", () => {
    const t1 = sessionTab(SERVER_A, "ses_1")
    const t2 = sessionTab(SERVER_A, "ses_2")
    const t3 = sessionTab(SERVER_B, "ses_3")

    const state: TabGroupsState = {
      ...DEFAULT_TAB_GROUPS_STATE,
      collapsed: { [`server:${SERVER_B}`]: true },
    }

    const groups = buildComputedTabGroups({
      items: [meta(t1), meta(t2), meta(t3)],
      state,
      mode: "server",
      serverCount: 2,
      query: "",
      labels,
    })!

    const moved = reorderTabKeysByGroups([t1, t2, t3], groups, 1, 0)
    expect(moved.groupKeys).toEqual([`server:${SERVER_B}`, `server:${SERVER_A}`])
    expect(moved.tabKeys).toEqual([tabKey(t3), tabKey(t1), tabKey(t2)])
  })
})
