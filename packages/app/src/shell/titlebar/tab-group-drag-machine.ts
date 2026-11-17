import {
  canonicalizeManualTabOrder,
  nextManualGroupColor,
  nextManualGroupNumber,
  pruneEmptyManualGroups,
  type ComputedTabGroup,
  type ManualTabGroup,
  type TabGroupColor,
  type TabGroupsState,
} from "./tab-groups"

export type MeasuredTopBlock =
  | {
      readonly kind: "group"
      readonly groupKey: string
      readonly manualId: string | undefined
      readonly tabKeys: readonly string[]
      readonly top: number
      readonly bottom: number
    }
  | {
      readonly kind: "tab"
      readonly tabKey: string
      readonly top: number
      readonly bottom: number
    }

export type MeasuredStripRow =
  | {
      readonly kind: "header"
      readonly groupKey: string
      readonly manualId: string | undefined
      readonly color: TabGroupColor
      readonly collapsed: boolean
      readonly firstTabKey: string | undefined
      readonly lastTabKey: string | undefined
      readonly top: number
      readonly bottom: number
    }
  | {
      readonly kind: "tab"
      readonly tabKey: string
      readonly groupKey: string | undefined
      readonly manualId: string | undefined
      readonly color: TabGroupColor | undefined
      readonly isFirstInGroup: boolean
      readonly isLastInGroup: boolean
      readonly top: number
      readonly bottom: number
      readonly tabTop: number
      readonly tabBottom: number
    }

export type VerticalDragGeometry = {
  readonly listLeft: number
  readonly freeform: boolean
  readonly nextGroupColor: TabGroupColor
  readonly blocks: readonly MeasuredTopBlock[]
  readonly rows: readonly MeasuredStripRow[]
}

export type VerticalDragSource =
  | {
      readonly kind: "group"
      readonly groupKey: string
      readonly label: string
      readonly color: TabGroupColor
      readonly count: number
    }
  | {
      readonly kind: "tab"
      readonly tabKey: string
      readonly label: string
      readonly groupKey: string | undefined
      readonly manualId: string | undefined
    }

export type VerticalDragIndicator =
  | {
      readonly kind: "line"
      readonly y: number
      readonly visualY: number
      readonly indented: boolean
      readonly groupKey: string | undefined
      readonly color: TabGroupColor | undefined
    }
  | {
      readonly kind: "combine-tab"
      readonly tabKey: string
      readonly color: TabGroupColor
    }
  | {
      readonly kind: "join-group"
      readonly groupKey: string
      readonly color: TabGroupColor
    }

export type VerticalDragIntent =
  | {
      readonly type: "move-group"
      readonly groupKey: string
      readonly beforeBlockIndex: number
    }
  | {
      readonly type: "place-tab"
      readonly tabKey: string
      readonly targetManualId: string | undefined
      readonly anchorTabKey: string | undefined
      readonly position: "before" | "after"
    }
  | {
      readonly type: "join-group"
      readonly tabKey: string
      readonly groupKey: string
      readonly manualId: string
      readonly prepend: boolean
    }
  | {
      readonly type: "combine-tabs"
      readonly sourceTabKey: string
      readonly targetTabKey: string
    }

export type VerticalDragRailAdjustment = {
  readonly top: number
  readonly bottom: number
  readonly empty: boolean
}

export type VerticalDragShifts = {
  readonly tabShiftY: Readonly<Record<string, number>>
  readonly groupShiftY: Readonly<Record<string, number>>
  readonly headerShiftY: Readonly<Record<string, number>>
  readonly railByGroup: Readonly<Record<string, VerticalDragRailAdjustment>>
  readonly laneShift: "in" | "out" | undefined
  readonly tucked: boolean
}

export type VerticalDragState =
  | { readonly status: "idle" }
  | {
      readonly status: "pending"
      readonly pointerId: number
      readonly pointerType: string
      readonly startX: number
      readonly startY: number
      readonly source: VerticalDragSource
    }
  | {
      readonly status: "dragging"
      readonly pointerId: number
      readonly startX: number
      readonly startY: number
      readonly currentX: number
      readonly currentY: number
      readonly dragOffsetY: number
      readonly source: VerticalDragSource
      readonly geometry: VerticalDragGeometry
      readonly indicator: VerticalDragIndicator | undefined
      readonly intent: VerticalDragIntent | undefined
      readonly shifts: VerticalDragShifts
    }

export type VerticalDragEvent =
  | {
      readonly type: "pointer.down"
      readonly pointerId: number
      readonly pointerType: string
      readonly x: number
      readonly y: number
      readonly source: VerticalDragSource
    }
  | {
      readonly type: "pointer.move"
      readonly pointerId: number
      readonly x: number
      readonly y: number
      readonly contentY: number
      readonly geometry?: VerticalDragGeometry
    }
  | {
      readonly type: "scroll.changed"
      readonly contentY: number
    }
  | { readonly type: "pointer.up"; readonly pointerId: number }
  | { readonly type: "cancel" }
  | { readonly type: "disposed" }

export type VerticalDragEffect =
  | { readonly type: "capture-pointer"; readonly pointerId: number }
  | { readonly type: "suppress-click" }
  | {
      readonly type: "commit"
      readonly blocks: readonly MeasuredTopBlock[]
      readonly intent: VerticalDragIntent
    }

export type VerticalDragTransition = {
  readonly state: VerticalDragState
  readonly effects: readonly VerticalDragEffect[]
}

export type VerticalDragHit = {
  readonly indicator: VerticalDragIndicator | undefined
  readonly intent: VerticalDragIntent | undefined
  readonly shifts: VerticalDragShifts
}

export type VerticalDragCommitResult = {
  readonly tabKeys: string[]
  readonly mode: TabGroupsState["mode"]
  readonly groupOrder: string[]
  readonly collapsed: Record<string, boolean>
  readonly manualGroups: ManualTabGroup[]
  readonly manualAssignments: Record<string, string>
}

export const INITIAL_VERTICAL_DRAG_STATE: VerticalDragState = Object.freeze({ status: "idle" })

const EMPTY_SHIFTS: VerticalDragShifts = Object.freeze({
  tabShiftY: Object.freeze({}),
  groupShiftY: Object.freeze({}),
  headerShiftY: Object.freeze({}),
  railByGroup: Object.freeze({}),
  laneShift: undefined,
  tucked: false,
})

const NONE: readonly never[] = Object.freeze([])

const SUPPRESS_CLICK: readonly VerticalDragEffect[] = Object.freeze([{ type: "suppress-click" }])

function unchanged(state: VerticalDragState): VerticalDragTransition {
  return { state, effects: NONE }
}

function sameIndicator(a: VerticalDragIndicator | undefined, b: VerticalDragIndicator | undefined) {
  if (a === b) return true

  if (!a || !b || a.kind !== b.kind) return false

  if (a.kind === "line" && b.kind === "line") {
    return (
      a.y === b.y &&
      a.visualY === b.visualY &&
      a.indented === b.indented &&
      a.groupKey === b.groupKey &&
      a.color === b.color
    )
  }

  if (a.kind === "combine-tab" && b.kind === "combine-tab") {
    return a.tabKey === b.tabKey && a.color === b.color
  }

  if (a.kind === "join-group" && b.kind === "join-group") {
    return a.groupKey === b.groupKey && a.color === b.color
  }

  return false
}

function sameIntent(a: VerticalDragIntent | undefined, b: VerticalDragIntent | undefined) {
  if (a === b) return true

  if (!a || !b || a.type !== b.type) return false

  if (a.type === "move-group" && b.type === "move-group") {
    return a.groupKey === b.groupKey && a.beforeBlockIndex === b.beforeBlockIndex
  }

  if (a.type === "place-tab" && b.type === "place-tab") {
    return (
      a.tabKey === b.tabKey &&
      a.targetManualId === b.targetManualId &&
      a.anchorTabKey === b.anchorTabKey &&
      a.position === b.position
    )
  }

  if (a.type === "join-group" && b.type === "join-group") {
    return (
      a.tabKey === b.tabKey &&
      a.groupKey === b.groupKey &&
      a.manualId === b.manualId &&
      a.prepend === b.prepend
    )
  }

  if (a.type === "combine-tabs" && b.type === "combine-tabs") {
    return a.sourceTabKey === b.sourceTabKey && a.targetTabKey === b.targetTabKey
  }

  return false
}

function computeClampedDragOffsetY(
  source: VerticalDragSource,
  geometry: VerticalDragGeometry,
  rawDeltaY: number,
) {
  if (source.kind === "group") {
    const block = geometry.blocks.find((item) => item.kind === "group" && item.groupKey === source.groupKey)

    if (!block) return rawDeltaY
    const firstTop = geometry.blocks[0]?.top ?? 0
    const lastBottom = geometry.blocks[geometry.blocks.length - 1]?.bottom ?? 0
    const minDelta = firstTop - block.top - 4
    const maxDelta = Math.max(0, lastBottom - block.bottom + 14)

    return Math.round(Math.max(minDelta, Math.min(maxDelta, rawDeltaY)))
  }

  const row = geometry.rows.find((item) => item.kind === "tab" && item.tabKey === source.tabKey)

  if (!row) return rawDeltaY
  const firstTop = geometry.rows[0]?.top ?? 0
  const lastBottom = geometry.rows[geometry.rows.length - 1]?.bottom ?? 0
  const minDelta = firstTop - row.top - 6
  const maxDelta = Math.max(0, lastBottom - row.bottom + 26)

  return Math.round(Math.max(minDelta, Math.min(maxDelta, rawDeltaY)))
}

export function selectNeedsDragMeasurement(
  state: VerticalDragState,
  pointerId: number,
  x: number,
  y: number,
) {
  if (state.status !== "pending" || state.pointerId !== pointerId) return false
  const threshold = state.pointerType === "touch" ? 8 : 4

  return Math.hypot(x - state.startX, y - state.startY) >= threshold
}

export function transitionVerticalDrag(state: VerticalDragState, event: VerticalDragEvent): VerticalDragTransition {
  if (event.type === "cancel" || event.type === "disposed") {
    return state.status === "idle" ? unchanged(state) : { state: INITIAL_VERTICAL_DRAG_STATE, effects: NONE }
  }

  if (event.type === "pointer.down") {
    return {
      state: {
        status: "pending",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.x,
        startY: event.y,
        source: event.source,
      },
      effects: NONE,
    }
  }

  if (event.type === "pointer.move") {
    if (state.status === "pending" && state.pointerId === event.pointerId) {
      if (!selectNeedsDragMeasurement(state, event.pointerId, event.x, event.y) || !event.geometry) {
        return unchanged(state)
      }

      const hit = hitTestVerticalDrag(state.source, event.geometry, event.x, event.contentY, undefined)
      const dragOffsetY = computeClampedDragOffsetY(state.source, event.geometry, event.y - state.startY)

      return {
        state: {
          status: "dragging",
          pointerId: state.pointerId,
          startX: state.startX,
          startY: state.startY,
          currentX: event.x,
          currentY: event.y,
          dragOffsetY,
          source: state.source,
          geometry: event.geometry,
          indicator: hit.indicator,
          intent: hit.intent,
          shifts: hit.shifts,
        },
        effects: [{ type: "capture-pointer", pointerId: state.pointerId }],
      }
    }

    if (state.status === "dragging" && state.pointerId === event.pointerId) {
      const hit = hitTestVerticalDrag(state.source, state.geometry, event.x, event.contentY, state.intent)
      const dragOffsetY = computeClampedDragOffsetY(state.source, state.geometry, event.y - state.startY)
      const unchangedHit = sameIndicator(state.indicator, hit.indicator) && sameIntent(state.intent, hit.intent)

      if (state.currentX === event.x && state.currentY === event.y && state.dragOffsetY === dragOffsetY && unchangedHit) {
        return unchanged(state)
      }

      return {
        state: {
          ...state,
          currentX: event.x,
          currentY: event.y,
          dragOffsetY,
          indicator: unchangedHit ? state.indicator : hit.indicator,
          intent: unchangedHit ? state.intent : hit.intent,
          shifts: unchangedHit ? state.shifts : hit.shifts,
        },
        effects: NONE,
      }
    }

    return unchanged(state)
  }

  if (event.type === "scroll.changed") {
    if (state.status !== "dragging") return unchanged(state)
    const hit = hitTestVerticalDrag(state.source, state.geometry, state.currentX, event.contentY, state.intent)

    if (sameIndicator(state.indicator, hit.indicator) && sameIntent(state.intent, hit.intent)) {
      return unchanged(state)
    }

    return {
      state: {
        ...state,
        indicator: hit.indicator,
        intent: hit.intent,
        shifts: hit.shifts,
      },
      effects: NONE,
    }
  }

  if (event.type === "pointer.up") {
    if (state.status === "idle" || state.pointerId !== event.pointerId) return unchanged(state)

    if (state.status === "dragging") {
      return {
        state: INITIAL_VERTICAL_DRAG_STATE,
        effects: state.intent
          ? [{ type: "suppress-click" }, { type: "commit", blocks: state.geometry.blocks, intent: state.intent }]
          : SUPPRESS_CLICK,
      }
    }

    return { state: INITIAL_VERTICAL_DRAG_STATE, effects: NONE }
  }

  return unchanged(state)
}

export function selectIsDraggingStrip(state: VerticalDragState) {
  return state.status === "dragging"
}

export function selectDraggingTabKey(state: VerticalDragState) {
  return state.status === "dragging" && state.source.kind === "tab" ? state.source.tabKey : undefined
}

export function selectDraggingGroupKey(state: VerticalDragState) {
  return state.status === "dragging" && state.source.kind === "group" ? state.source.groupKey : undefined
}

export function selectDraggedOffsetY(state: VerticalDragState) {
  return state.status === "dragging" ? state.dragOffsetY : 0
}

export function selectDraggedLaneShift(state: VerticalDragState) {
  return state.status === "dragging" ? state.shifts.laneShift : undefined
}

export function selectDraggedTucked(state: VerticalDragState) {
  return state.status === "dragging" && state.shifts.tucked
}

export function selectTabShiftY(state: VerticalDragState, tabKey: string) {
  return state.status === "dragging" ? (state.shifts.tabShiftY[tabKey] ?? 0) : 0
}

export function selectGroupShiftY(state: VerticalDragState, groupKey: string) {
  return state.status === "dragging" ? (state.shifts.groupShiftY[groupKey] ?? 0) : 0
}

export function selectHeaderShiftY(state: VerticalDragState, groupKey: string) {
  return state.status === "dragging" ? (state.shifts.headerShiftY[groupKey] ?? 0) : 0
}

export function selectGroupRailAdjustment(state: VerticalDragState, groupKey: string) {
  return state.status === "dragging" ? state.shifts.railByGroup[groupKey] : undefined
}

export function selectCombineColorOfTab(state: VerticalDragState, tabKey: string) {
  if (state.status !== "dragging" || state.indicator?.kind !== "combine-tab") return undefined

  return state.indicator.tabKey === tabKey ? state.indicator.color : undefined
}

export function selectJoinGroupKey(state: VerticalDragState) {
  if (state.status !== "dragging" || state.indicator?.kind !== "join-group") return undefined

  return state.indicator.groupKey
}

export function selectDropInsideGroupKey(state: VerticalDragState) {
  if (state.status !== "dragging" || state.indicator?.kind !== "line" || !state.indicator.indented) return undefined

  return state.indicator.groupKey
}

export function selectDropLine(state: VerticalDragState) {
  if (state.status !== "dragging" || state.indicator?.kind !== "line") return undefined

  return state.indicator
}

export function hitTestVerticalDrag(
  source: VerticalDragSource,
  geometry: VerticalDragGeometry,
  x: number,
  contentY: number,
  previousIntent: VerticalDragIntent | undefined,
): VerticalDragHit {
  if (source.kind === "group") {
    return hitTestGroupMove(source.groupKey, geometry.blocks, contentY)
  }

  const raw = geometry.freeform
    ? hitTestFreeformTabMove(source, geometry, x, contentY, previousIntent)
    : hitTestIntraGroupTabMove(source, geometry.rows, contentY)

  return attachTabSlideShifts(source, geometry, raw.indicator, raw.intent)
}

function hitTestGroupMove(
  groupKey: string,
  blocks: readonly MeasuredTopBlock[],
  y: number,
): VerticalDragHit {
  if (blocks.length <= 1) return { indicator: undefined, intent: undefined, shifts: EMPTY_SHIFTS }

  const selfIndex = blocks.findIndex((block) => block.kind === "group" && block.groupKey === groupKey)

  if (selfIndex === -1) return { indicator: undefined, intent: undefined, shifts: EMPTY_SHIFTS }

  let beforeIndex = blocks.length

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    const height = Math.max(1, block.bottom - block.top)
    // Blocks below the dragged group flip as soon as the cursor crosses their header (~36px), so dragging a small group
    // past a tall 10-tab group never requires traversing all 10 tabs. Blocks above flip at their midpoint.
    const pivot = i < selfIndex ? (block.top + block.bottom) / 2 : block.top + Math.min(height * 0.5, 36)

    if (y < pivot) {
      beforeIndex = i
      break
    }
  }

  if (beforeIndex === selfIndex || beforeIndex === selfIndex + 1) {
    return { indicator: undefined, intent: undefined, shifts: EMPTY_SHIFTS }
  }

  const selfBlock = blocks[selfIndex]!

  const groupStride =
    selfIndex < blocks.length - 1
      ? blocks[selfIndex + 1]!.top - selfBlock.top
      : selfIndex > 0
        ? selfBlock.bottom - blocks[selfIndex - 1]!.bottom
        : selfBlock.bottom - selfBlock.top + 5

  const groupShiftY: Record<string, number> = {}
  const tabShiftY: Record<string, number> = {}

  if (beforeIndex < selfIndex) {
    for (let i = beforeIndex; i < selfIndex; i++) {
      const b = blocks[i]!

      if (b.kind === "group") groupShiftY[b.groupKey] = groupStride

      if (b.kind === "tab") tabShiftY[b.tabKey] = groupStride
    }
  }

  if (beforeIndex > selfIndex + 1) {
    for (let i = selfIndex + 1; i < beforeIndex; i++) {
      const b = blocks[i]!

      if (b.kind === "group") groupShiftY[b.groupKey] = -groupStride

      if (b.kind === "tab") tabShiftY[b.tabKey] = -groupStride
    }
  }

  const lineY =
    beforeIndex === 0
      ? Math.max(3, blocks[0]!.top - 2)
      : beforeIndex >= blocks.length
        ? blocks[blocks.length - 1]!.bottom + 3
        : (blocks[beforeIndex - 1]!.bottom + blocks[beforeIndex]!.top) / 2

  const visualY =
    beforeIndex < selfIndex
      ? lineY
      : Math.max(3, blocks[beforeIndex - 1]!.bottom - groupStride + 2.5)

  return {
    indicator: { kind: "line", y: lineY, visualY, indented: false, groupKey: undefined, color: undefined },
    intent: { type: "move-group", groupKey, beforeBlockIndex: beforeIndex },
    shifts: {
      tabShiftY,
      groupShiftY,
      headerShiftY: EMPTY_SHIFTS.headerShiftY,
      railByGroup: EMPTY_SHIFTS.railByGroup,
      laneShift: undefined,
      tucked: false,
    },
  }
}

type RawTabHit = {
  readonly indicator: VerticalDragIndicator | undefined
  readonly intent: VerticalDragIntent | undefined
}

function attachTabSlideShifts(
  source: Extract<VerticalDragSource, { kind: "tab" }>,
  geometry: VerticalDragGeometry,
  indicator: VerticalDragIndicator | undefined,
  intent: VerticalDragIntent | undefined,
): VerticalDragHit {
  if (!indicator || !intent) {
    return { indicator: undefined, intent: undefined, shifts: EMPTY_SHIFTS }
  }

  const rows = geometry.rows
  const selfRowIdx = rows.findIndex((row) => row.kind === "tab" && row.tabKey === source.tabKey)

  if (selfRowIdx === -1) {
    return { indicator, intent, shifts: EMPTY_SHIFTS }
  }

  const sourceRow = rows[selfRowIdx]!
  const prevRow = rows[selfRowIdx - 1]
  const nextRow = rows[selfRowIdx + 1]

  const tabStride =
    nextRow?.kind === "tab" && sourceRow.kind === "tab" && nextRow.groupKey === sourceRow.groupKey
      ? nextRow.top - sourceRow.top
      : prevRow?.kind === "tab" && sourceRow.kind === "tab" && prevRow.groupKey === sourceRow.groupKey
        ? sourceRow.bottom - prevRow.bottom
        : sourceRow.bottom - sourceRow.top + (source.groupKey ? 2 : 3)

  const sourceIndented = source.groupKey !== undefined

  if (indicator.kind === "combine-tab" || indicator.kind === "join-group") {
    const targetIndented = indicator.kind === "join-group"
    const laneShift = targetIndented === sourceIndented ? undefined : targetIndented ? "in" : "out"
    const tabShiftY: Record<string, number> = {}
    const headerShiftY: Record<string, number> = {}

    const targetRow =
      indicator.kind === "combine-tab"
        ? rows.find((r) => r.kind === "tab" && r.tabKey === indicator.tabKey)
        : rows.find((r) => r.kind === "header" && r.groupKey === indicator.groupKey)

    if (targetRow && targetRow.top < sourceRow.top) {
      rows.forEach((row) => {
        if (row.top <= sourceRow.bottom) return

        if (row.kind === "header") headerShiftY[row.groupKey] = -tabStride

        if (row.kind === "tab") tabShiftY[row.tabKey] = -tabStride
      })
    }

    return {
      indicator,
      intent,
      shifts: {
        tabShiftY,
        groupShiftY: EMPTY_SHIFTS.groupShiftY,
        headerShiftY,
        railByGroup: EMPTY_SHIFTS.railByGroup,
        laneShift,
        tucked: true,
      },
    }
  }

  const sCenter = (sourceRow.top + sourceRow.bottom) / 2
  const rawY = indicator.y
  const tabShiftY: Record<string, number> = {}
  const headerShiftY: Record<string, number> = {}

  rows.forEach((row) => {
    if (row.kind === "tab" && row.tabKey === source.tabKey) return
    const rCenter = (row.top + row.bottom) / 2

    const shift =
      rawY < sCenter
        ? rawY < rCenter && rCenter < sCenter
          ? tabStride
          : 0
        : sCenter < rCenter && rCenter < rawY
          ? -tabStride
          : 0

    if (shift === 0) return

    if (row.kind === "header") headerShiftY[row.groupKey] = shift

    if (row.kind === "tab") tabShiftY[row.tabKey] = shift
  })

  const visualY = Math.max(3, rawY < sCenter ? rawY + tabStride * 0.5 : rawY - tabStride * 0.5)

  const railByGroup: Record<string, VerticalDragRailAdjustment> = {}
  const groupOrigBounds = new Map<string, { top: number; bottom: number }>()
  const groupShiftedBounds = new Map<string, { top: number; bottom: number }>()

  rows.forEach((row) => {
    if (row.kind !== "tab" || !row.groupKey) return
    const gk = row.groupKey
    const orig = groupOrigBounds.get(gk)
    groupOrigBounds.set(gk, {
      top: orig ? Math.min(orig.top, row.top) : row.top,
      bottom: orig ? Math.max(orig.bottom, row.bottom) : row.bottom,
    })

    if (row.tabKey === source.tabKey) return
    const dy = tabShiftY[row.tabKey] ?? 0
    const cur = groupShiftedBounds.get(gk)
    groupShiftedBounds.set(gk, {
      top: cur ? Math.min(cur.top, row.top + dy) : row.top + dy,
      bottom: cur ? Math.max(cur.bottom, row.bottom + dy) : row.bottom + dy,
    })
  })

  if (indicator.indented && indicator.groupKey) {
    const gk = indicator.groupKey
    const cur = groupShiftedBounds.get(gk)
    const slotTop = visualY - 14
    const slotBottom = visualY + 14
    groupShiftedBounds.set(gk, {
      top: cur ? Math.min(cur.top, slotTop) : slotTop,
      bottom: cur ? Math.max(cur.bottom, slotBottom) : slotBottom,
    })
  }

  groupOrigBounds.forEach((orig, gk) => {
    const shifted = groupShiftedBounds.get(gk)

    if (!shifted) {
      railByGroup[gk] = { top: 0, bottom: 0, empty: true }

      return
    }

    const dTop = Math.round(shifted.top - orig.top)
    const dBottom = Math.round(shifted.bottom - orig.bottom)

    if (dTop !== 0 || dBottom !== 0) {
      railByGroup[gk] = { top: dTop, bottom: dBottom, empty: false }
    }
  })

  const laneShift = indicator.indented === sourceIndented ? undefined : indicator.indented ? "in" : "out"

  return {
    indicator: { ...indicator, visualY },
    intent,
    shifts: {
      tabShiftY,
      groupShiftY: EMPTY_SHIFTS.groupShiftY,
      headerShiftY,
      railByGroup,
      laneShift,
      tucked: false,
    },
  }
}

function hitTestIntraGroupTabMove(
  source: Extract<VerticalDragSource, { kind: "tab" }>,
  rows: readonly MeasuredStripRow[],
  y: number,
): RawTabHit {
  const peers = rows.flatMap((row) =>
    row.kind === "tab" && row.groupKey === source.groupKey ? [row] : [],
  )

  if (peers.length <= 1) return { indicator: undefined, intent: undefined }

  const selfIdx = peers.findIndex((row) => row.tabKey === source.tabKey)

  if (selfIdx === -1) return { indicator: undefined, intent: undefined }

  let insertIdx = peers.length

  for (let i = 0; i < peers.length; i++) {
    const mid = (peers[i]!.tabTop + peers[i]!.tabBottom) / 2

    if (y < mid) {
      insertIdx = i
      break
    }
  }

  if (insertIdx === selfIdx || insertIdx === selfIdx + 1) {
    return { indicator: undefined, intent: undefined }
  }

  const color = peers[0]?.color
  const indented = !!source.groupKey

  if (insertIdx === 0) {
    const rawY = Math.max(3, peers[0]!.top - 1.5)

    return {
      indicator: {
        kind: "line",
        y: rawY,
        visualY: rawY,
        indented,
        groupKey: source.groupKey,
        color,
      },
      intent: {
        type: "place-tab",
        tabKey: source.tabKey,
        targetManualId: source.manualId,
        anchorTabKey: peers[0]!.tabKey,
        position: "before",
      },
    }
  }

  if (insertIdx >= peers.length) {
    const last = peers[peers.length - 1]!
    const rawY = last.bottom + 1.5

    return {
      indicator: {
        kind: "line",
        y: rawY,
        visualY: rawY,
        indented,
        groupKey: source.groupKey,
        color,
      },
      intent: {
        type: "place-tab",
        tabKey: source.tabKey,
        targetManualId: source.manualId,
        anchorTabKey: last.tabKey,
        position: "after",
      },
    }
  }

  const prev = peers[insertIdx - 1]!
  const next = peers[insertIdx]!
  const rawY = (prev.bottom + next.top) / 2

  return {
    indicator: {
      kind: "line",
      y: rawY,
      visualY: rawY,
      indented,
      groupKey: source.groupKey,
      color,
    },
    intent: {
      type: "place-tab",
      tabKey: source.tabKey,
      targetManualId: source.manualId,
      anchorTabKey: next.tabKey,
      position: "before",
    },
  }
}

function seamBeforeRow(rows: readonly MeasuredStripRow[], index: number) {
  if (index <= 0) return Math.max(3, rows[0]!.top - 2)

  return (rows[index - 1]!.bottom + rows[index]!.top) / 2
}

function seamAfterRow(rows: readonly MeasuredStripRow[], index: number) {
  if (index >= rows.length - 1) return rows[rows.length - 1]!.bottom + 4

  return (rows[index]!.bottom + rows[index + 1]!.top) / 2
}

function hitTestFreeformTabMove(
  source: Extract<VerticalDragSource, { kind: "tab" }>,
  geometry: VerticalDragGeometry,
  x: number,
  y: number,
  previousIntent: VerticalDragIntent | undefined,
): RawTabHit {
  const rows = geometry.rows

  if (rows.length === 0) return { indicator: undefined, intent: undefined }

  const outdentLane = x < geometry.listLeft + 12

  const makePlace = (
    lineY: number,
    targetManualId: string | undefined,
    groupKey: string | undefined,
    color: TabGroupColor | undefined,
    anchorTabKey: string | undefined,
    position: "before" | "after",
  ): RawTabHit => {
    if (isNoOpTabPlacement(source, rows, targetManualId, anchorTabKey, position)) {
      return { indicator: undefined, intent: undefined }
    }

    const indented = targetManualId !== undefined
    const clampedY = Math.max(3, lineY)

    return {
      indicator: {
        kind: "line",
        y: clampedY,
        visualY: clampedY,
        indented,
        groupKey: indented ? groupKey : undefined,
        color: indented ? color : undefined,
      },
      intent: {
        type: "place-tab",
        tabKey: source.tabKey,
        targetManualId,
        anchorTabKey,
        position,
      },
    }
  }

  const first = rows[0]!

  if (y < first.top) {
    const firstAnchor = first.kind === "tab" ? first.tabKey : first.firstTabKey

    return makePlace(seamBeforeRow(rows, 0), undefined, undefined, undefined, firstAnchor, "before")
  }

  const last = rows[rows.length - 1]!

  if (y > last.bottom) {
    const lastAnchor = last.kind === "tab" ? last.tabKey : last.lastTabKey

    return makePlace(seamAfterRow(rows, rows.length - 1), undefined, undefined, undefined, lastAnchor, "after")
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!

    if (y >= row.top && y <= row.bottom) {
      const height = Math.max(1, row.bottom - row.top)

      if (row.kind === "header") {
        if (y < row.top + height * 0.25) {
          return makePlace(seamBeforeRow(rows, i), undefined, undefined, undefined, row.firstTabKey, "before")
        }

        if (row.collapsed && y > row.bottom - height * 0.25) {
          return makePlace(seamAfterRow(rows, i), undefined, undefined, undefined, row.lastTabKey, "after")
        }

        if (!row.manualId) return { indicator: undefined, intent: undefined }

        if (source.manualId === row.manualId) {
          const next = rows[i + 1]

          const insideTopY =
            next?.kind === "tab" && next.groupKey === row.groupKey ? (row.bottom + next.top) / 2 : row.bottom + 1.5

          return makePlace(insideTopY, row.manualId, row.groupKey, row.color, row.firstTabKey, "before")
        }

        return {
          indicator: { kind: "join-group", groupKey: row.groupKey, color: row.color },
          intent: {
            type: "join-group",
            tabKey: source.tabKey,
            groupKey: row.groupKey,
            manualId: row.manualId,
            prepend: !row.collapsed,
          },
        }
      }

      if (row.tabKey === source.tabKey) {
        if (row.manualId && outdentLane) {
          const lastIdx = findLastTabIndexInGroup(rows, row.manualId)
          const groupLast = lastIdx !== -1 ? rows[lastIdx] : undefined

          return makePlace(
            seamAfterRow(rows, lastIdx !== -1 ? lastIdx : i),
            undefined,
            undefined,
            undefined,
            groupLast?.kind === "tab" ? groupLast.tabKey : row.tabKey,
            "after",
          )
        }

        return { indicator: undefined, intent: undefined }
      }

      if (row.manualId) {
        if (outdentLane) {
          const lastIdx = findLastTabIndexInGroup(rows, row.manualId)
          const groupLast = lastIdx !== -1 ? rows[lastIdx] : undefined

          return makePlace(
            seamAfterRow(rows, lastIdx !== -1 ? lastIdx : i),
            undefined,
            undefined,
            undefined,
            groupLast?.kind === "tab" ? groupLast.tabKey : row.tabKey,
            "after",
          )
        }

        const mid = (row.tabTop + row.tabBottom) / 2

        if (y < mid) {
          return makePlace(seamBeforeRow(rows, i), row.manualId, row.groupKey, row.color, row.tabKey, "before")
        }

        const afterY = row.isLastInGroup ? row.bottom + 1.5 : seamAfterRow(rows, i)

        return makePlace(afterY, row.manualId, row.groupKey, row.color, row.tabKey, "after")
      }

      // Ungrouped tab row: 3-zone iOS folder split (top = above, center = group together, bottom = below) with hysteresis.
      const tabHeight = Math.max(1, row.tabBottom - row.tabTop)

      const wasCombining =
        previousIntent?.type === "combine-tabs" && previousIntent.targetTabKey === row.tabKey

      const edge = wasCombining ? 0.18 : 0.27

      if (y < row.tabTop + tabHeight * edge) {
        return makePlace(seamBeforeRow(rows, i), undefined, undefined, undefined, row.tabKey, "before")
      }

      if (y > row.tabBottom - tabHeight * edge) {
        return makePlace(seamAfterRow(rows, i), undefined, undefined, undefined, row.tabKey, "after")
      }

      return {
        indicator: { kind: "combine-tab", tabKey: row.tabKey, color: geometry.nextGroupColor },
        intent: { type: "combine-tabs", sourceTabKey: source.tabKey, targetTabKey: row.tabKey },
      }
    }

    const next = rows[i + 1]

    if (next && y > row.bottom && y < next.top) {
      const midGap = (row.bottom + next.top) / 2

      if (row.kind === "header" && next.kind === "tab" && next.groupKey === row.groupKey && row.manualId) {
        return makePlace(midGap, row.manualId, row.groupKey, row.color, next.tabKey, "before")
      }

      if (row.kind === "tab" && next.kind === "tab" && row.manualId && row.manualId === next.manualId) {
        if (outdentLane) {
          const lastIdx = findLastTabIndexInGroup(rows, row.manualId)
          const groupLast = lastIdx !== -1 ? rows[lastIdx] : undefined

          return makePlace(
            seamAfterRow(rows, lastIdx !== -1 ? lastIdx : i),
            undefined,
            undefined,
            undefined,
            groupLast?.kind === "tab" ? groupLast.tabKey : row.tabKey,
            "after",
          )
        }

        return makePlace(midGap, row.manualId, row.groupKey, row.color, next.tabKey, "before")
      }

      const nextAnchor = next.kind === "tab" ? next.tabKey : next.firstTabKey

      if (nextAnchor) {
        return makePlace(midGap, undefined, undefined, undefined, nextAnchor, "before")
      }

      if (row.kind === "tab") {
        return makePlace(midGap, undefined, undefined, undefined, row.tabKey, "after")
      }
    }
  }

  return { indicator: undefined, intent: undefined }
}

function findLastTabIndexInGroup(rows: readonly MeasuredStripRow[], manualId: string) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!

    if (row.kind === "tab" && row.manualId === manualId) return i
  }

  return -1
}

function isNoOpTabPlacement(
  source: Extract<VerticalDragSource, { kind: "tab" }>,
  rows: readonly MeasuredStripRow[],
  targetManualId: string | undefined,
  anchorTabKey: string | undefined,
  position: "before" | "after",
) {
  if (source.manualId !== targetManualId) return false

  if (anchorTabKey === source.tabKey) return true

  const tabRows = rows.flatMap((row) => (row.kind === "tab" ? [row] : []))
  const selfIndex = tabRows.findIndex((row) => row.tabKey === source.tabKey)

  if (selfIndex === -1) return false

  if (position === "before") {
    const nextRow = tabRows[selfIndex + 1]

    return !!nextRow && nextRow.tabKey === anchorTabKey && nextRow.manualId === targetManualId
  }

  const prevRow = tabRows[selfIndex - 1]

  return !!prevRow && prevRow.tabKey === anchorTabKey && prevRow.manualId === targetManualId
}

export function applyVerticalDragCommit(input: {
  allTabKeys: readonly string[]
  groups: readonly ComputedTabGroup[] | undefined
  blocks: readonly MeasuredTopBlock[]
  state: TabGroupsState
  intent: VerticalDragIntent
  createGroupId: () => string
  createGroupName: (number: number) => string
}): VerticalDragCommitResult {
  const { allTabKeys, blocks, state, intent } = input
  let nextMode = state.mode
  const nextCollapsed = { ...state.collapsed }
  let nextManualGroups = [...state.manualGroups]
  const nextAssignments = { ...state.manualAssignments }
  let nextGroupOrder = [...(state.groupOrder ?? [])]
  let nextTabKeys = [...allTabKeys]

  if (intent.type === "move-group") {
    const fromIdx = blocks.findIndex((block) => block.kind === "group" && block.groupKey === intent.groupKey)

    if (fromIdx !== -1) {
      const targetIdx = intent.beforeBlockIndex > fromIdx ? intent.beforeBlockIndex - 1 : intent.beforeBlockIndex
      const copy = [...blocks]
      const [moved] = copy.splice(fromIdx, 1)

      if (moved) {
        copy.splice(Math.max(0, Math.min(targetIdx, copy.length)), 0, moved)
        const orderedFromBlocks = copy.flatMap((block) => (block.kind === "group" ? block.tabKeys : [block.tabKey]))
        const seen = new Set(orderedFromBlocks)
        nextTabKeys = [...orderedFromBlocks, ...allTabKeys.filter((key) => !seen.has(key))]
        nextGroupOrder = copy.flatMap((block) => (block.kind === "group" ? [block.groupKey] : []))

        if (nextManualGroups.length > 1) {
          const manualRank = new Map(
            nextGroupOrder
              .flatMap((key) => (key.startsWith("manual:") ? [key.slice("manual:".length)] : []))
              .map((id, idx) => [id, idx]),
          )

          nextManualGroups.sort((a, b) => (manualRank.get(a.id) ?? 999) - (manualRank.get(b.id) ?? 999))
        }
      }
    }

    return {
      tabKeys: nextTabKeys,
      mode: nextMode,
      groupOrder: nextGroupOrder,
      collapsed: nextCollapsed,
      manualGroups: nextManualGroups,
      manualAssignments: nextAssignments,
    }
  }

  if (intent.type === "combine-tabs") {
    nextMode = "none"
    const id = input.createGroupId()
    const color = nextManualGroupColor(nextManualGroups)
    const number = nextManualGroupNumber(nextManualGroups, input.createGroupName)
    const name = input.createGroupName(number)
    nextManualGroups.push({ id, name, color })
    nextAssignments[intent.targetTabKey] = id
    nextAssignments[intent.sourceTabKey] = id
    nextTabKeys = placeKeyRelativeTo(allTabKeys, intent.sourceTabKey, intent.targetTabKey, "after")
    nextManualGroups = pruneEmptyManualGroups(nextManualGroups, nextAssignments)
    nextTabKeys = canonicalizeManualTabOrder(nextTabKeys, nextAssignments, intent.targetTabKey)

    return {
      tabKeys: nextTabKeys,
      mode: nextMode,
      groupOrder: nextGroupOrder,
      collapsed: nextCollapsed,
      manualGroups: nextManualGroups,
      manualAssignments: nextAssignments,
    }
  }

  if (intent.type === "join-group") {
    nextMode = "none"
    nextAssignments[intent.tabKey] = intent.manualId
    nextCollapsed[`manual:${intent.manualId}`] = false

    const groupMembers = allTabKeys.filter(
      (key) => key !== intent.tabKey && nextAssignments[key] === intent.manualId,
    )

    const anchor = intent.prepend ? groupMembers[0] : groupMembers[groupMembers.length - 1]

    if (anchor) {
      nextTabKeys = placeKeyRelativeTo(allTabKeys, intent.tabKey, anchor, intent.prepend ? "before" : "after")
    }

    nextManualGroups = pruneEmptyManualGroups(nextManualGroups, nextAssignments)
    nextTabKeys = canonicalizeManualTabOrder(
      nextTabKeys,
      nextAssignments,
      intent.prepend ? intent.tabKey : undefined,
    )

    return {
      tabKeys: nextTabKeys,
      mode: nextMode,
      groupOrder: nextGroupOrder,
      collapsed: nextCollapsed,
      manualGroups: nextManualGroups,
      manualAssignments: nextAssignments,
    }
  }

  if (state.mode === "none" || nextManualGroups.length > 0 || intent.targetManualId !== undefined) {
    if (intent.targetManualId) {
      nextMode = "none"
      nextAssignments[intent.tabKey] = intent.targetManualId
    }

    if (!intent.targetManualId && nextAssignments[intent.tabKey]) {
      delete nextAssignments[intent.tabKey]
    }

    nextManualGroups = pruneEmptyManualGroups(nextManualGroups, nextAssignments)
  }

  if (intent.anchorTabKey) {
    nextTabKeys = placeKeyRelativeTo(allTabKeys, intent.tabKey, intent.anchorTabKey, intent.position)
  }

  if (nextMode === "none" && nextManualGroups.length > 0) {
    nextTabKeys = canonicalizeManualTabOrder(nextTabKeys, nextAssignments, intent.tabKey)
  }

  return {
    tabKeys: nextTabKeys,
    mode: nextMode,
    groupOrder: nextGroupOrder,
    collapsed: nextCollapsed,
    manualGroups: nextManualGroups,
    manualAssignments: nextAssignments,
  }
}

function placeKeyRelativeTo(
  keys: readonly string[],
  movedKey: string,
  anchorKey: string,
  position: "before" | "after",
): string[] {
  if (movedKey === anchorKey) return [...keys]
  const without = keys.filter((key) => key !== movedKey)
  const anchorIdx = without.indexOf(anchorKey)

  if (anchorIdx === -1) return [...keys]
  const insertAt = position === "before" ? anchorIdx : anchorIdx + 1
  const out = [...without]
  out.splice(insertAt, 0, movedKey)

  return out
}
