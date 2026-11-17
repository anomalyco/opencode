import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { tabKey, type Tab } from "@/shell/tabs/tabs"
import {
  applyVerticalDragCommit,
  hitTestVerticalDrag,
  INITIAL_VERTICAL_DRAG_STATE,
  selectNeedsDragMeasurement,
  transitionVerticalDrag,
  type MeasuredStripRow,
  type MeasuredTopBlock,
  type VerticalDragGeometry,
  type VerticalDragSource,
} from "./tab-group-drag-machine"
import {
  buildComputedTabGroups,
  canonicalizeManualTabOrder,
  DEFAULT_TAB_GROUPS_STATE,
  nextManualGroupColor,
  reconcileManualAssignments,
  type ComputedTabGroup,
  type ResolvedTabMeta,
  type TabGroupsState,
} from "./tab-groups"

const SERVER_A = ServerConnection.Key.make("http://127.0.0.1:4096")

const SERVER_B = ServerConnection.Key.make("http://127.0.0.1:4097")

const SERVER_C = ServerConnection.Key.make("http://127.0.0.1:4098")

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
    serverLabel: tab.server === SERVER_A ? "local" : tab.server === SERVER_B ? "blade" : "vps",
    title: tab.type === "session" ? tab.sessionId : tab.draftID,
    projectID: tab.server === SERVER_A ? "proj_a" : tab.server === SERVER_B ? "proj_b" : "proj_c",
    projectName: tab.server === SERVER_A ? "opencode" : tab.server === SERVER_B ? "blade-repo" : "vps-repo",
    directory: "/work/app",
    active: false,
    ...overrides,
  }
}

const labels = {
  other: "Other",
}

/** Synthesizes realistic vertical sidebar geometry (26px headers, 28px tab rows, 3px outer gaps, 2px inner gaps). */
function layoutStripGeometry(
  tabs: readonly Tab[],
  groups: readonly ComputedTabGroup[] | undefined,
  state: TabGroupsState,
  freeform: boolean,
): VerticalDragGeometry {
  const blocks: MeasuredTopBlock[] = []
  const rows: MeasuredStripRow[] = []
  let y = 0

  if (!groups) {
    tabs.forEach((tab) => {
      const key = tabKey(tab)
      blocks.push({ kind: "tab", tabKey: key, top: y, bottom: y + 28 })
      rows.push({
        kind: "tab",
        tabKey: key,
        groupKey: undefined,
        manualId: undefined,
        color: undefined,
        isFirstInGroup: false,
        isLastInGroup: false,
        top: y,
        bottom: y + 28,
        tabTop: y,
        tabBottom: y + 28,
      })
      y += 31
    })

    return {
      listLeft: 12,
      freeform,
      nextGroupColor: nextManualGroupColor(state.manualGroups),
      blocks,
      rows,
    }
  }

  groups.forEach((group) => {
    if (group.kind === "ungrouped") {
      group.visibleTabs.forEach((tab) => {
        const key = tabKey(tab)
        blocks.push({ kind: "tab", tabKey: key, top: y, bottom: y + 28 })
        rows.push({
          kind: "tab",
          tabKey: key,
          groupKey: undefined,
          manualId: undefined,
          color: undefined,
          isFirstInGroup: false,
          isLastInGroup: false,
          top: y,
          bottom: y + 28,
          tabTop: y,
          tabBottom: y + 28,
        })
        y += 31
      })

      return
    }

    const groupTop = y
    const allKeys = group.allTabs.map(tabKey)
    rows.push({
      kind: "header",
      groupKey: group.key,
      manualId: group.manualId,
      color: group.color,
      collapsed: group.collapsed,
      firstTabKey: allKeys[0],
      lastTabKey: allKeys[allKeys.length - 1],
      top: y,
      bottom: y + 26,
    })
    y += 26

    if (!group.collapsed && group.visibleTabs.length > 0) {
      y += 1
      group.visibleTabs.forEach((tab, idx) => {
        const key = tabKey(tab)
        rows.push({
          kind: "tab",
          tabKey: key,
          groupKey: group.key,
          manualId: group.manualId,
          color: group.color,
          isFirstInGroup: idx === 0,
          isLastInGroup: idx === group.visibleTabs.length - 1,
          top: y,
          bottom: y + 28,
          tabTop: y,
          tabBottom: y + 28,
        })
        y += idx === group.visibleTabs.length - 1 ? 28 : 30
      })
    }

    blocks.push({
      kind: "group",
      groupKey: group.key,
      manualId: group.manualId,
      tabKeys: allKeys,
      top: groupTop,
      bottom: y,
    })
    y += 5
  })

  return {
    listLeft: 12,
    freeform,
    nextGroupColor: nextManualGroupColor(state.manualGroups),
    blocks,
    rows,
  }
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

  test("preserves identical group colors across arbitrary tab and group reorderings", () => {
    const a = meta(sessionTab(SERVER_A, "ses_a"))
    const b = meta(sessionTab(SERVER_B, "ses_b"))
    const c = meta(sessionTab(SERVER_C, "ses_c"))

    const forward = buildComputedTabGroups({
      items: [a, b, c],
      state: DEFAULT_TAB_GROUPS_STATE,
      mode: "server",
      serverCount: 3,
      query: "",
      labels,
    })!

    const reversed = buildComputedTabGroups({
      items: [c, b, a],
      state: { ...DEFAULT_TAB_GROUPS_STATE, groupOrder: [`server:${SERVER_C}`, `server:${SERVER_A}`, `server:${SERVER_B}`] },
      mode: "server",
      serverCount: 3,
      query: "",
      labels,
    })!

    const colorMapForward = Object.fromEntries(forward.map((group) => [group.key, group.color]))
    const colorMapReversed = Object.fromEntries(reversed.map((group) => [group.key, group.color]))
    expect(colorMapReversed).toEqual(colorMapForward)

    // Explicitly recoloring one server group (e.g. blade -> blue, then pink) never changes another server's hue.
    for (const bladeColor of ["blue", "green", "orange", "purple", "cyan", "pink"] as const) {
      const recolored = buildComputedTabGroups({
        items: [a, b, c],
        state: {
          ...DEFAULT_TAB_GROUPS_STATE,
          overrides: { [`server:${SERVER_B}`]: { color: bladeColor } },
        },
        mode: "server",
        serverCount: 3,
        query: "",
        labels,
      })!

      const byKey = Object.fromEntries(recolored.map((group) => [group.key, group.color]))
      expect(byKey[`server:${SERVER_B}`]).toBe(bladeColor)
      expect(byKey[`server:${SERVER_A}`]).toBe(colorMapForward[`server:${SERVER_A}`])
      expect(byKey[`server:${SERVER_C}`]).toBe(colorMapForward[`server:${SERVER_C}`])
    }
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

  test("splits ungrouped tabs into top (above), center (iOS folder combine with hysteresis), and bottom (below) zones", () => {
    const t1 = sessionTab(SERVER_A, "ses_1")
    const t2 = sessionTab(SERVER_A, "ses_2")
    const t3 = sessionTab(SERVER_A, "ses_3")
    const state: TabGroupsState = { ...DEFAULT_TAB_GROUPS_STATE, mode: "none" }
    const geometry = layoutStripGeometry([t1, t2, t3], undefined, state, true)

    const source: VerticalDragSource = {
      kind: "tab",
      tabKey: tabKey(t3),
      label: "ses_3",
      groupKey: undefined,
      manualId: undefined,
    }

    // t1 occupies y = 0..28: top edge (< 7.5) places before t1; center (14) combines into a folder; bottom (> 20.5) places after t1.
    const above = hitTestVerticalDrag(source, geometry, 60, 4, undefined)
    expect(above.indicator?.kind).toBe("line")
    expect(above.shifts.tabShiftY).toEqual({
      [tabKey(t1)]: 31,
      [tabKey(t2)]: 31,
    })
    expect(above.shifts.tucked).toBe(false)
    expect(above.intent).toEqual({
      type: "place-tab",
      tabKey: tabKey(t3),
      targetManualId: undefined,
      anchorTabKey: tabKey(t1),
      position: "before",
    })

    const center = hitTestVerticalDrag(source, geometry, 60, 14, above.intent)
    expect(center.indicator).toEqual({ kind: "combine-tab", tabKey: tabKey(t1), color: "blue" })
    expect(center.shifts.tabShiftY).toEqual({ [tabKey(t2)]: 31 })
    expect(center.shifts.laneShift).toBe("in")
    expect(center.intent).toEqual({
      type: "combine-tabs",
      sourceTabKey: tabKey(t3),
      targetTabKey: tabKey(t1),
    })

    // Hysteresis keeps combine armed when the finger drifts slightly toward the edge (y = 22 is > 20.44 but < 22.96).
    const drift = hitTestVerticalDrag(source, geometry, 60, 22, center.intent)
    expect(drift.intent).toEqual(center.intent)

    const below = hitTestVerticalDrag(source, geometry, 60, 25, center.intent)
    expect(below.indicator?.kind).toBe("line")
    expect(below.intent).toEqual({
      type: "place-tab",
      tabKey: tabKey(t3),
      targetManualId: undefined,
      anchorTabKey: tabKey(t1),
      position: "after",
    })

    // Committing the center combine creates Group 1 at t1's position with [t1, t3, t2].
    const committed = applyVerticalDragCommit({
      allTabKeys: [tabKey(t1), tabKey(t2), tabKey(t3)],
      groups: undefined,
      blocks: geometry.blocks,
      state,
      intent: center.intent!,
      createGroupId: () => "g_folder",
      createGroupName: (n) => `Group ${n}`,
    })

    expect(committed.manualGroups).toEqual([{ id: "g_folder", name: "Group 1", color: "blue" }])
    expect(committed.tabKeys).toEqual([tabKey(t1), tabKey(t3), tabKey(t2)])
    expect(committed.manualAssignments).toEqual({
      [tabKey(t1)]: "g_folder",
      [tabKey(t3)]: "g_folder",
    })
  })

  test("reorders a small group past a tall 8-tab group as soon as the pointer crosses the tall group's header", () => {
    const smallTab = sessionTab(SERVER_A, "ses_small")
    const tallTabs = Array.from({ length: 8 }, (_, idx) => sessionTab(SERVER_B, `ses_tall_${idx}`))
    const allTabs = [smallTab, ...tallTabs]

    const groups = buildComputedTabGroups({
      items: allTabs.map((item) => meta(item)),
      state: DEFAULT_TAB_GROUPS_STATE,
      mode: "server",
      serverCount: 2,
      query: "",
      labels,
    })!

    const geometry = layoutStripGeometry(allTabs, groups, DEFAULT_TAB_GROUPS_STATE, false)
    const tallBlock = geometry.blocks[1]!
    expect(tallBlock.bottom - tallBlock.top).toBeGreaterThan(220)

    const source: VerticalDragSource = {
      kind: "group",
      groupKey: `server:${SERVER_A}`,
      label: "local",
      color: "blue",
      count: 1,
    }

    // Just 40px past the tall group's top (crossing its 26px header, nowhere near its 130px midpoint) flips the order.
    const hit = hitTestVerticalDrag(source, geometry, 60, tallBlock.top + 40, undefined)
    expect(hit.intent).toEqual({
      type: "move-group",
      groupKey: `server:${SERVER_A}`,
      beforeBlockIndex: 2,
    })

    const committed = applyVerticalDragCommit({
      allTabKeys: allTabs.map(tabKey),
      groups,
      blocks: geometry.blocks,
      state: DEFAULT_TAB_GROUPS_STATE,
      intent: hit.intent!,
      createGroupId: () => "unused",
      createGroupName: (n) => `Group ${n}`,
    })

    expect(committed.groupOrder).toEqual([`server:${SERVER_B}`, `server:${SERVER_A}`])
    expect(committed.tabKeys).toEqual([...tallTabs.map(tabKey), tabKey(smallTab)])
  })

  test("keeps VerticalDragState allocation-free on sub-threshold and unchanged pointer moves", () => {
    const source: VerticalDragSource = {
      kind: "tab",
      tabKey: "ses_1",
      label: "Alpha",
      groupKey: undefined,
      manualId: undefined,
    }

    const down = transitionVerticalDrag(INITIAL_VERTICAL_DRAG_STATE, {
      type: "pointer.down",
      pointerId: 1,
      pointerType: "mouse",
      x: 40,
      y: 20,
      source,
    })

    expect(down.state.status).toBe("pending")
    expect(selectNeedsDragMeasurement(down.state, 1, 41, 22)).toBe(false)

    const tinyMove = transitionVerticalDrag(down.state, {
      type: "pointer.move",
      pointerId: 1,
      x: 41,
      y: 22,
      contentY: 22,
    })

    expect(tinyMove.state).toBe(down.state)
    expect(selectNeedsDragMeasurement(down.state, 1, 40, 45)).toBe(true)

    const t1 = sessionTab(SERVER_A, "ses_1")
    const t2 = sessionTab(SERVER_A, "ses_2")
    const geometry = layoutStripGeometry([t1, t2], undefined, { ...DEFAULT_TAB_GROUPS_STATE, mode: "none" }, true)

    const active = transitionVerticalDrag(down.state, {
      type: "pointer.move",
      pointerId: 1,
      x: 40,
      y: 45,
      contentY: 45,
      geometry,
    })

    expect(active.state.status).toBe("dragging")
    expect(active.effects).toEqual([{ type: "capture-pointer", pointerId: 1 }])

    const duplicateMove = transitionVerticalDrag(active.state, {
      type: "pointer.move",
      pointerId: 1,
      x: 40,
      y: 45,
      contentY: 45,
    })

    expect(duplicateMove.state).toBe(active.state)

    const released = transitionVerticalDrag(active.state, { type: "pointer.up", pointerId: 1 })

    expect(released.state).toBe(INITIAL_VERTICAL_DRAG_STATE)
    expect(released.effects[0]).toEqual({ type: "suppress-click" })
    expect(released.effects[1]?.type).toBe("commit")
  })

  test("keeps manual groups contiguous and prunes emptied groups when moving tabs across and out of groups", () => {
    const t1 = sessionTab(SERVER_A, "ses_1")
    const t2 = sessionTab(SERVER_A, "ses_2")
    const t3 = sessionTab(SERVER_A, "ses_3")
    const t4 = sessionTab(SERVER_A, "ses_4")

    const initialState: TabGroupsState = {
      ...DEFAULT_TAB_GROUPS_STATE,
      mode: "none",
      manualGroups: [
        { id: "g_a", name: "Group 1", color: "blue" },
        { id: "g_b", name: "Group 2", color: "green" },
      ],
      manualAssignments: {
        [tabKey(t1)]: "g_a",
        [tabKey(t3)]: "g_b",
        [tabKey(t4)]: "g_b",
      },
    }

    // Moving t1 (the sole member of g_a) onto g_b's header prepends it to g_b and dissolves empty g_a.
    const groups = buildComputedTabGroups({
      items: [t1, t2, t3, t4].map((item) => meta(item)),
      state: initialState,
      mode: "none",
      serverCount: 1,
      query: "",
      labels,
    })!

    const geometry = layoutStripGeometry([t1, t2, t3, t4], groups, initialState, true)

    const joined = applyVerticalDragCommit({
      allTabKeys: [t1, t2, t3, t4].map(tabKey),
      groups,
      blocks: geometry.blocks,
      state: initialState,
      intent: {
        type: "join-group",
        tabKey: tabKey(t1),
        groupKey: "manual:g_b",
        manualId: "g_b",
        prepend: true,
      },
      createGroupId: () => "unused",
      createGroupName: (n) => `Group ${n}`,
    })

    expect(joined.manualGroups).toEqual([{ id: "g_b", name: "Group 2", color: "green" }])
    expect(joined.tabKeys).toEqual([tabKey(t2), tabKey(t1), tabKey(t3), tabKey(t4)])

    // Inserting a new ungrouped tab mid-slice canonicalizes back to contiguous group storage order.
    const insertedKey = tabKey(sessionTab(SERVER_A, "ses_new"))
    expect(
      canonicalizeManualTabOrder([tabKey(t1), insertedKey, tabKey(t3), tabKey(t4)], joined.manualAssignments),
    ).toEqual([tabKey(t1), tabKey(t3), tabKey(t4), insertedKey])
  })

  test("keeps drop-line Y strictly monotonic across a 1px vertical sweep over mixed groups and tabs", () => {
    const tabs = ["ses_1", "ses_2", "ses_3", "ses_4", "ses_5"].map((id) => sessionTab(SERVER_A, id))

    const state: TabGroupsState = {
      ...DEFAULT_TAB_GROUPS_STATE,
      mode: "none",
      collapsed: { "manual:g_closed": true },
      manualGroups: [
        { id: "g_open", name: "Open", color: "blue" },
        { id: "g_closed", name: "Closed", color: "purple" },
      ],
      manualAssignments: {
        [tabKey(tabs[0]!)]: "g_open",
        [tabKey(tabs[1]!)]: "g_open",
        [tabKey(tabs[4]!)]: "g_closed",
      },
    }

    const groups = buildComputedTabGroups({
      items: tabs.map((item) => meta(item)),
      state,
      mode: "none",
      serverCount: 1,
      query: "",
      labels,
    })!

    const geometry = layoutStripGeometry(tabs, groups, state, true)
    const maxBottom = geometry.rows[geometry.rows.length - 1]!.bottom

    const source: VerticalDragSource = {
      kind: "tab",
      tabKey: tabKey(tabs[2]!),
      label: "ses_3",
      groupKey: undefined,
      manualId: undefined,
    }

    let prevLineY = -Infinity
    let prevIntent = undefined

    for (let py = -10; py <= maxBottom + 16; py += 1) {
      const hit = hitTestVerticalDrag(source, geometry, 64, py, prevIntent)
      prevIntent = hit.intent

      if (hit.indicator?.kind === "line") {
        expect(hit.indicator.y).toBeGreaterThanOrEqual(prevLineY)
        prevLineY = hit.indicator.y
      }
    }
  })
})
