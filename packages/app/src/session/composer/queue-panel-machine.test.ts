import { describe, expect, test } from "bun:test"
import type { QueueRow } from "./queue-machine"
import {
  createQueuePanelState,
  DISPOSED_QUEUE_PANEL_EVENT,
  isQueuePanelOpen,
  PANEL_CLOSED_EVENT,
  queuePanelAnyExpanded,
  queuePanelCount,
  queuePanelListExpanded,
  transitionQueuePanel,
  type QueuePanelEvent,
  type QueuePanelState,
} from "./queue-panel-machine"

const row = (id: string): QueueRow => ({ id, text: `${id} text`, attachments: 0 })

const sync = (
  ids: string[],
  options: { moved?: Record<string, string>; hidden?: boolean; stagger?: number } = {},
): Extract<QueuePanelEvent, { type: "sync" }> => ({
  type: "sync",
  rows: ids.map(row),
  moved: options.moved ?? {},
  hidden: options.hidden ?? false,
  stagger: options.stagger ?? 0,
  reducedMotion: false,
})

const phases = (state: QueuePanelState) =>
  state.status === "disposed" ? [] : state.entries.map((entry) => `${entry.id}:${entry.phase}`)

const expansion = (state: QueuePanelState) =>
  state.status === "disposed" ? [] : state.entries.map((entry) => `${entry.id}:${entry.expanded}`)

function play(state: QueuePanelState, events: QueuePanelEvent[]) {
  return events.reduce((current, event) => transitionQueuePanel(current, event).state, state)
}

const open = (ids: string[]) => createQueuePanelState(ids.map(row), false)

describe("queue panel", () => {
  test("a prompt delivered as another is queued closes while the new one grows in", () => {
    const next = transitionQueuePanel(open(["A", "B"]), sync(["B", "C"]))

    expect(phases(next.state)).toEqual(["A:leaving", "B:present", "C:entering"])
    expect(queuePanelCount(next.state)).toBe(2)

    const closed = transitionQueuePanel(next.state, { type: "row.closed", id: "A" })
    expect(phases(closed.state)).toEqual(["B:present", "C:entering"])
  })

  test("an edited prompt swaps in place under its new ID, even as another prompt is queued", () => {
    expect(phases(play(open(["id_1", "B"]), [sync(["id_2", "B"], { moved: { id_1: "id_2" } })]))).toEqual([
      "id_2:present",
      "B:present",
    ])

    expect(phases(play(open(["id_1", "B"]), [sync(["id_2", "B", "D"], { moved: { id_1: "id_2" } })]))).toEqual([
      "id_2:present",
      "B:present",
      "D:entering",
    ])
  })

  test("a reorder swaps every row in place", () => {
    const moved = { A: "A2", B: "B2" }

    expect(phases(play(open(["A", "B"]), [sync(["B2", "A2"], { moved })]))).toEqual(["B2:present", "A2:present"])
  })

  test("prompts delivered while a dock hides the panel leave no ghost rows", () => {
    const state = play(open(["A", "B"]), [
      sync(["A", "B"], { hidden: true }),
      PANEL_CLOSED_EVENT,
      sync([], { hidden: true }),
      sync(["C"], { hidden: true }),
    ])

    expect(state.status).toBe("closed")

    const shown = transitionQueuePanel(state, sync(["C"]))
    expect(isQueuePanelOpen(shown.state)).toBe(true)
    expect(phases(shown.state)).toEqual(["C:present"])
  })

  test("the last prompts stay drawn while the emptied panel closes", () => {
    const closing = transitionQueuePanel(open(["A", "B"]), sync([])).state

    expect(closing.status).toBe("closing")
    expect(phases(closing)).toEqual(["A:leaving", "B:leaving"])
    expect(queuePanelCount(closing)).toBe(2)
    expect(phases(transitionQueuePanel(closing, PANEL_CLOSED_EVENT).state)).toEqual([])
  })

  test.each([
    ["unmounts", DISPOSED_QUEUE_PANEL_EVENT],
    ["closes", sync(["A"], { hidden: true })],
  ])("a cascade queued before the panel %s never starts", (_name, event) => {
    const closed = createQueuePanelState([row("A")], true)
    const opened = transitionQueuePanel(closed, sync(["A"], { stagger: 0.04 }))
    const attempt = opened.state.status === "open" ? opened.state.attempt : -1

    expect(opened.effects).toEqual([{ type: "cascade.schedule", attempt }])
    expect(transitionQueuePanel(opened.state, { type: "cascade.ready", attempt }).effects).toEqual([
      { type: "cascade.paint", step: 0.04 },
    ])

    const left = transitionQueuePanel(opened.state, event)
    expect(left.effects).toEqual([{ type: "cascade.cancel" }])

    const late = transitionQueuePanel(left.state, { type: "cascade.ready", attempt })
    expect(late.state).toBe(left.state)
    expect(late.effects).toEqual([])
  })

  test("an emptied collapsed queue closes as a summary and comes back in full with a new prompt", () => {
    const collapsed = play(open(["A", "B"]), [{ type: "list.expanded", expanded: false }])
    const closing = transitionQueuePanel(collapsed, sync([])).state

    expect(queuePanelListExpanded(closing)).toBe(false)

    const closed = transitionQueuePanel(closing, PANEL_CLOSED_EVENT).state

    expect(queuePanelListExpanded(closed)).toBe(true)

    const reopened = transitionQueuePanel(closed, sync(["C"])).state

    expect(queuePanelListExpanded(reopened)).toBe(true)
    expect(queuePanelCount(reopened)).toBe(1)
  })

  test("a panel open from the start does not cascade, and an unchanged row keeps its entry", () => {
    const rows = [row("A")]
    const state = createQueuePanelState(rows, false)
    const next = transitionQueuePanel(state, { ...sync([]), rows })
    const entries = (value: QueuePanelState) => (value.status === "disposed" ? [] : value.entries)

    expect(next.effects).toEqual([])
    expect(entries(next.state)[0]).toBe(entries(state)[0]!)
  })

  test("a row expands and collapses on its own, and the panel knows when any row is expanded", () => {
    const state = open(["A", "B"])

    expect(queuePanelAnyExpanded(state)).toBe(false)

    const first = transitionQueuePanel(state, { type: "row.expanded", id: "A", expanded: true })

    expect(expansion(first.state)).toEqual(["A:true", "B:false"])
    expect(queuePanelAnyExpanded(first.state)).toBe(true)

    const second = transitionQueuePanel(first.state, { type: "row.expanded", id: "B", expanded: true })

    expect(expansion(second.state)).toEqual(["A:true", "B:true"])

    const collapsed = transitionQueuePanel(second.state, { type: "row.expanded", id: "A", expanded: false })

    expect(expansion(collapsed.state)).toEqual(["A:false", "B:true"])
    expect(queuePanelAnyExpanded(collapsed.state)).toBe(true)
  })

  test("the bulk action hides and restores the whole list without changing per-message expansion", () => {
    const mixed = play(open(["A", "B", "C"]), [
      { type: "row.expanded", id: "A", expanded: true },
      { type: "row.expanded", id: "C", expanded: true },
    ])

    expect(queuePanelAnyExpanded(mixed)).toBe(true)
    expect(queuePanelListExpanded(mixed)).toBe(true)

    const collapsed = transitionQueuePanel(mixed, { type: "list.expanded", expanded: false }).state

    expect(queuePanelListExpanded(collapsed)).toBe(false)
    expect(queuePanelCount(collapsed)).toBe(3)
    expect(expansion(collapsed)).toEqual(["A:true", "B:false", "C:true"])

    const restored = transitionQueuePanel(collapsed, { type: "list.expanded", expanded: true }).state

    expect(queuePanelListExpanded(restored)).toBe(true)
    expect(expansion(restored)).toEqual(["A:true", "B:false", "C:true"])
  })

  test("a single prompt keeps its row disclosure and never collapses the whole list", () => {
    const single = open(["A"])

    expect(transitionQueuePanel(single, { type: "list.expanded", expanded: false }).state).toBe(single)
  })

  test("a collapsed list comes back in full when only one prompt remains", () => {
    const collapsed = play(open(["A", "B"]), [{ type: "list.expanded", expanded: false }])

    expect(queuePanelListExpanded(collapsed)).toBe(false)

    const remaining = transitionQueuePanel(collapsed, sync(["A"])).state

    expect(queuePanelListExpanded(remaining)).toBe(true)
    expect(queuePanelCount(remaining)).toBe(1)
  })

  test("expansion follows a prompt whose inbox ID an edit or reorder replaced", () => {
    const state = play(open(["A", "B"]), [{ type: "row.expanded", id: "A", expanded: true }])

    expect(expansion(transitionQueuePanel(state, sync(["A2", "B"], { moved: { A: "A2" } })).state)).toEqual([
      "A2:true",
      "B:false",
    ])
    expect(expansion(transitionQueuePanel(state, sync(["B2", "A2"], { moved: { A: "A2", B: "B2" } })).state)).toEqual([
      "B2:false",
      "A2:true",
    ])
  })

  test("a newly queued prompt starts collapsed while its expanded neighbours keep their state", () => {
    const state = play(open(["A", "B"]), [
      { type: "row.expanded", id: "A", expanded: true },
      { type: "row.expanded", id: "B", expanded: true },
    ])

    expect(expansion(transitionQueuePanel(state, sync(["A", "B", "C"])).state)).toEqual(["A:true", "B:true", "C:false"])
  })

  test("expansion survives the panel being hidden and reopened", () => {
    const expanded = play(open(["A", "B"]), [{ type: "row.expanded", id: "B", expanded: true }])
    const closed = play(expanded, [sync(["A", "B"], { hidden: true }), PANEL_CLOSED_EVENT])

    expect(expansion(closed)).toEqual(["A:false", "B:true"])
    expect(expansion(transitionQueuePanel(closed, sync(["A", "B"])).state)).toEqual(["A:false", "B:true"])
  })
})
