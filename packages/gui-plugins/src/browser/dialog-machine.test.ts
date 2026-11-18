import { describe, expect, test } from "bun:test"
import {
  createDialogGateState,
  selectDialog,
  selectDialogTarget,
  selectOpenDialog,
  transitionDialogGate,
  type DialogGateEvent,
  type DialogGateState,
} from "./dialog-machine"

const replay = (events: readonly DialogGateEvent[], state: DialogGateState = createDialogGateState()) =>
  events.reduce((current, event) => transitionDialogGate(current, event).state, state)

const alert = (message: string): DialogGateEvent => ({
  type: "dialog.opened",
  url: "https://alpha.example/form",
  dialogType: "alert",
  message,
  defaultPrompt: "",
})

describe("handling a dialog", () => {
  test("keeps a dialog the page opened while the handle was in flight", () => {
    const first = replay([alert("first")])
    const revision = selectOpenDialog(first)!.revision
    // Chromium closes the first alert and opens the second before handleJavaScriptDialog resolves.
    const chained = replay([{ type: "dialog.closed" }, alert("second")], first)
    const handled = transitionDialogGate(chained, { type: "dialog.handled", revision })

    expect(handled.state).toBe(chained)
    expect(selectDialog(handled.state)).toEqual({ type: "alert", message: "second", defaultValue: "" })
  })

  test("closes the dialog once when the handle answers before Chromium's close event", () => {
    const open = replay([alert("first")])
    const handled = transitionDialogGate(open, { type: "dialog.handled", revision: selectOpenDialog(open)!.revision })

    expect(handled.effects).toEqual([{ type: "publish" }])
    expect(selectDialog(handled.state)).toBeNull()
    expect(transitionDialogGate(handled.state, { type: "dialog.closed" }).effects).toEqual([])
  })

  test("asks permission for the current page, not the closed dialog's", () => {
    const open = replay([alert("first")])
    expect(selectDialogTarget(open, 3, "https://alpha.example/next")).toEqual({
      resources: ["https://alpha.example/form"],
      key: "3:1:true",
    })

    const closed = replay([{ type: "dialog.closed" }], open)
    expect(selectDialogTarget(closed, 3, "https://alpha.example/next")).toEqual({
      resources: ["https://alpha.example/next"],
      key: "3:2:false",
    })
  })
})

describe("starting a command", () => {
  test("refuses a command whose caller already aborted", () => {
    expect(
      transitionDialogGate(createDialogGateState(), { type: "run.started", actionType: "click", aborted: true }).reply,
    ).toEqual({ status: "refused", reason: "cancelled" })
  })

  test("refuses every command but a dialog command while a dialog is open", () => {
    const open = replay([alert("first")])

    expect(transitionDialogGate(open, { type: "run.started", actionType: "click", aborted: false }).reply).toEqual({
      status: "refused",
      reason: "dialog-open",
    })
    expect(transitionDialogGate(open, { type: "run.started", actionType: "dialog", aborted: false }).reply).toEqual({
      status: "accepted",
      runID: 1,
    })
  })
})

describe("a running command", () => {
  const running = replay([
    { type: "run.started", actionType: "click", aborted: false },
    { type: "run.started", actionType: "navigate", aborted: false },
    { type: "run.started", actionType: "dialog", aborted: false },
  ])

  test("is interrupted by a dialog that opens before its first step; a navigation keeps loading", () => {
    const opened = transitionDialogGate(running, alert("validation"))

    expect(opened.effects).toEqual([
      { type: "interrupt-run", runID: 1, reason: "dialog-interrupted", abort: true },
      { type: "interrupt-run", runID: 2, reason: "dialog-interrupted", abort: false },
      { type: "publish" },
    ])
    // The dialog command that answers it keeps running.
    expect(transitionDialogGate(opened.state, { type: "run.cancelled", runID: 3 }).effects).toEqual([
      { type: "interrupt-run", runID: 3, reason: "cancelled", abort: true },
    ])
  })

  test("is cancelled once, and a finished run is forgotten", () => {
    const cancelled = transitionDialogGate(running, { type: "run.cancelled", runID: 1 })
    expect(cancelled.effects).toEqual([{ type: "interrupt-run", runID: 1, reason: "cancelled", abort: true }])
    expect(transitionDialogGate(cancelled.state, { type: "run.finished", runID: 1 }).state).toBe(cancelled.state)

    const finished = transitionDialogGate(running, { type: "run.finished", runID: 2 }).state
    expect(transitionDialogGate(finished, { type: "run.cancelled", runID: 2 }).effects).toEqual([])
  })

  test("is aborted when the page closes, and nothing starts afterwards", () => {
    const disposed = transitionDialogGate(running, { type: "disposed" })

    expect(disposed.effects).toEqual([
      { type: "interrupt-run", runID: 1, reason: "closed", abort: true },
      { type: "interrupt-run", runID: 2, reason: "closed", abort: true },
      { type: "interrupt-run", runID: 3, reason: "closed", abort: true },
    ])
    expect(
      transitionDialogGate(disposed.state, { type: "run.started", actionType: "click", aborted: false }).reply,
    ).toEqual({ status: "refused", reason: "closed" })
    expect(transitionDialogGate(disposed.state, alert("late")).state).toBe(disposed.state)
  })
})
