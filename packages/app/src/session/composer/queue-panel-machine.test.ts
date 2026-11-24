import { describe, expect, test } from "bun:test"
import type { QueueRow } from "./queue-machine"
import {
  createQueuePanelState,
  DISPOSED_QUEUE_PANEL_EVENT,
  isQueuePanelOpen,
  PANEL_CLOSED_EVENT,
  queuePanelCount,
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

  test("a panel open from the start does not cascade, and an unchanged row keeps its entry", () => {
    const rows = [row("A")]
    const state = createQueuePanelState(rows, false)
    const next = transitionQueuePanel(state, { ...sync([]), rows })
    const entries = (value: QueuePanelState) => (value.status === "disposed" ? [] : value.entries)

    expect(next.effects).toEqual([])
    expect(entries(next.state)[0]).toBe(entries(state)[0]!)
  })
})
