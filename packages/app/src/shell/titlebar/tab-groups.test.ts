import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { tabKey, type Tab } from "@/shell/tabs/tabs"
import {
  applyVerticalDragCommit,
  hitTestVerticalDrag,
  INITIAL_VERTICAL_DRAG_STATE,
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
    expect(above.intent).toEqual({
      type: "place-tab",
      tabKey: tabKey(t3),
      targetManualId: undefined,
      anchorTabKey: tabKey(t1),
      position: "before",
    })

    const center = hitTestVerticalDrag(source, geometry, 60, 14, above.intent)
    expect(center.indicator).toEqual({ kind: "combine-tab", tabKey: tabKey(t1), color: "blue" })
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

    const tinyMove = transitionVerticalDrag(down.state, {
      type: "pointer.move",
      pointerId: 1,
      x: 41,
      y: 22,
      contentY: 22,
      measure: () => {
        throw new Error("must not measure before crossing activation threshold")
      },
    })

    expect(tinyMove.state).toBe(down.state)

    const t1 = sessionTab(SERVER_A, "ses_1")
    const t2 = sessionTab(SERVER_A, "ses_2")
    const geometry = layoutStripGeometry([t1, t2], undefined, { ...DEFAULT_TAB_GROUPS_STATE, mode: "none" }, true)

    const active = transitionVerticalDrag(down.state, {
      type: "pointer.move",
      pointerId: 1,
      x: 40,
      y: 45,
      contentY: 45,
      measure: () => geometry,
    })

    expect(active.state.status).toBe("dragging")
    expect(active.effects).toEqual([{ type: "capture-pointer", pointerId: 1 }])

    const duplicateMove = transitionVerticalDrag(active.state, {
      type: "pointer.move",
      pointerId: 1,
      x: 40,
      y: 45,
      contentY: 45,
      measure: () => geometry,
    })

    expect(duplicateMove.state).toBe(active.state)

    const released = transitionVerticalDrag(active.state, { type: "pointer.up", pointerId: 1 })

    expect(released.state).toBe(INITIAL_VERTICAL_DRAG_STATE)
    expect(released.effects[0]).toEqual({ type: "suppress-click" })
    expect(released.effects[1]?.type).toBe("commit")
  })

  test("fuzzes 2,500 random tab and group drag operations without losing tabs, splitting groups, or mutating colors", () => {
    let seed = 0x5eed1234

    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0

      return seed / 0x100000000
    }

    const servers = [SERVER_A, SERVER_B, SERVER_C]
    let tabs: Tab[] = Array.from({ length: 9 }, (_, idx) => sessionTab(servers[idx % 3]!, `ses_fuzz_${idx}`))
    const expectedKeys = new Set(tabs.map(tabKey))

    const state: TabGroupsState = {
      mode: "none",
      groupOrder: [],
      collapsed: {},
      overrides: {},
      manualGroups: [],
      manualAssignments: {},
    }

    let nextGroupSeq = 1

    const baselineServerColors = Object.fromEntries(
      buildComputedTabGroups({
        items: tabs.map((item) => meta(item)),
        state: DEFAULT_TAB_GROUPS_STATE,
        mode: "server",
        serverCount: 3,
        query: "",
        labels,
      })!.map((group) => [group.key, group.color]),
    )

    for (let step = 0; step < 2_500; step++) {
      if (rand() < 0.08) {
        const modes = ["none", "server", "project"] as const
        const nextMode = modes[Math.floor(rand() * modes.length)]!
        state.mode = nextMode

        if (nextMode === "none" && state.manualGroups.length > 0) {
          const byKey = new Map(tabs.map((tab) => [tabKey(tab), tab]))
          tabs = canonicalizeManualTabOrder(tabs.map(tabKey), state.manualAssignments).map((key) => byKey.get(key)!)
        }
      }

      const groups = buildComputedTabGroups({
        items: tabs.map((item) => meta(item)),
        state,
        mode: state.mode,
        serverCount: 3,
        query: "",
        labels,
      })

      if (groups && groups.length > 0 && rand() < 0.1) {
        const pick = groups[Math.floor(rand() * groups.length)]!

        if (pick.kind !== "ungrouped") {
          state.collapsed[pick.key] = !state.collapsed[pick.key]
        }
      }

      const refreshedGroups = buildComputedTabGroups({
        items: tabs.map((item) => meta(item)),
        state,
        mode: state.mode,
        serverCount: 3,
        query: "",
        labels,
      })

      const freeform = state.mode === "none"
      const geometry = layoutStripGeometry(tabs, refreshedGroups, state, freeform)
      const maxY = (geometry.rows[geometry.rows.length - 1]?.bottom ?? 100) + 30

      const groupSources = (refreshedGroups ?? []).filter((group) => group.kind !== "ungrouped")
      const tabRows = geometry.rows.flatMap((row) => (row.kind === "tab" ? [row] : []))

      const pickGroupSource = groupSources.length > 1 && rand() < 0.3

      const source: VerticalDragSource | undefined = pickGroupSource
        ? (() => {
            const g = groupSources[Math.floor(rand() * groupSources.length)]!

            return { kind: "group", groupKey: g.key, label: g.name, color: g.color, count: g.allTabs.length }
          })()
        : tabRows.length > 0
          ? (() => {
              const r = tabRows[Math.floor(rand() * tabRows.length)]!

              return {
                kind: "tab",
                tabKey: r.tabKey,
                label: r.tabKey,
                groupKey: r.groupKey,
                manualId: r.manualId,
              }
            })()
          : undefined

      if (!source) continue

      const x = rand() < 0.15 ? 4 : 64
      const y = -20 + rand() * (maxY + 40)
      const hit = hitTestVerticalDrag(source, geometry, x, y, undefined)

      if (hit.intent) {
        const byKey = new Map(tabs.map((tab) => [tabKey(tab), tab]))

        const committed = applyVerticalDragCommit({
          allTabKeys: tabs.map(tabKey),
          groups: refreshedGroups,
          blocks: geometry.blocks,
          state,
          intent: hit.intent,
          createGroupId: () => `g_${nextGroupSeq++}`,
          createGroupName: (n) => `Group ${n}`,
        })

        tabs = committed.tabKeys.map((key) => byKey.get(key)!)
        state.mode = committed.mode
        state.groupOrder = committed.groupOrder
        state.collapsed = committed.collapsed
        state.manualGroups = committed.manualGroups
        state.manualAssignments = committed.manualAssignments
      }

      // Invariant 1: Exact bijective tab set preserved.
      expect(tabs.length).toBe(expectedKeys.size)
      expect(new Set(tabs.map(tabKey))).toEqual(expectedKeys)

      // Invariant 2: No empty manual groups survive, and every manual group's tabs stay contiguous in storage order.
      const populatedIds = new Set(Object.values(state.manualAssignments))
      state.manualGroups.forEach((group) => {
        expect(populatedIds.has(group.id)).toBe(true)
      })

      if (state.mode === "none" && state.manualGroups.length > 0) {
        const finishedGroups = new Set<string>()
        let currentGroup: string | undefined

        tabs.forEach((tab) => {
          const gid = state.manualAssignments[tabKey(tab)]

          if (gid !== currentGroup) {
            if (currentGroup) finishedGroups.add(currentGroup)

            if (gid) expect(finishedGroups.has(gid)).toBe(false)
            currentGroup = gid
          }
        })
      }

      // Invariant 3: Automatic server colors never drift regardless of tab or group order.
      if (state.mode === "server") {
        const serverCheck = buildComputedTabGroups({
          items: tabs.map((item) => meta(item)),
          state,
          mode: "server",
          serverCount: 3,
          query: "",
          labels,
        })!

        expect(Object.fromEntries(serverCheck.map((group) => [group.key, group.color]))).toEqual(baselineServerColors)
      }

      // Invariant 4: Every 50th step, sweep a pointer 1px at a time from top to bottom and verify monotonic drop-line Y.
      if (step % 50 === 0) {
        let prevLineY = -Infinity
        let prevIntent = undefined

        for (let py = -12; py <= maxY + 12; py += 1) {
          const sweep = hitTestVerticalDrag(source, geometry, 64, py, prevIntent)
          prevIntent = sweep.intent

          if (sweep.indicator?.kind === "line") {
            expect(sweep.indicator.y).toBeGreaterThanOrEqual(prevLineY)
            prevLineY = sweep.indicator.y
          }
        }
      }
    }
  })
})
