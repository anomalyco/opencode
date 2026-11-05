import { describe, expect, test } from "bun:test"
import {
  ABOUT_COPY_CLOSE_MS,
  ABOUT_COPY_OPEN_MS,
  ABOUT_COPY_WRITE_TIMEOUT_MS,
  INITIAL_ABOUT_COPY_STATE,
  selectAboutCopyView,
  transitionAboutCopy,
  type AboutCopyEffect,
  type AboutCopyEvent,
  type AboutCopyState,
} from "./machine"

function replay(events: AboutCopyEvent[], state = INITIAL_ABOUT_COPY_STATE) {
  return events.reduce<{ state: AboutCopyState; effects: readonly AboutCopyEffect[] }>(
    (step, event) => transitionAboutCopy(step.state, event),
    { state, effects: [] },
  )
}

const copied: AboutCopyEvent[] = [
  { type: "copy.requested", text: "Version 1.2.3" },
  { type: "copy.succeeded", attempt: 1 },
]

describe("about copy machine", () => {
  test("hiding the page closes the forced-open Copied tooltip at once", () => {
    const shown = replay(copied)
    expect(selectAboutCopyView(shown.state)).toEqual({ disabled: false, copied: true, forceOpen: true })

    const hidden = replay([{ type: "hidden" }], shown.state)
    expect(selectAboutCopyView(hidden.state)).toEqual({ disabled: false, copied: false, forceOpen: undefined })
    expect(hidden.effects).toEqual([{ type: "timer.clear" }])
    expect(transitionAboutCopy(hidden.state, { type: "tooltip.close-due", attempt: 1 }).state).toBe(hidden.state)
  })

  test.each([
    { name: "shown", events: copied },
    { name: "closing", events: [...copied, { type: "tooltip.close-due", attempt: 1 } as const] },
  ])("copying again while $name keeps Copied instead of flashing Copy", (row) => {
    const again = replay([{ type: "copy.requested", text: "Version 1.2.3" }], replay(row.events).state)

    expect(selectAboutCopyView(again.state)).toEqual({ disabled: true, copied: true, forceOpen: true })
    expect(again.effects).toEqual([
      { type: "timer.schedule", event: "copy.timed-out", attempt: 2, delayMs: ABOUT_COPY_WRITE_TIMEOUT_MS },
      { type: "clipboard.write", attempt: 2, text: "Version 1.2.3" },
    ])
  })

  test("the tooltip closes, then drops its label after the close animation", () => {
    const shown = replay(copied)
    expect(shown.effects).toEqual([
      { type: "timer.schedule", event: "tooltip.close-due", attempt: 1, delayMs: ABOUT_COPY_OPEN_MS },
    ])

    const closing = replay([{ type: "tooltip.close-due", attempt: 1 }], shown.state)
    expect(selectAboutCopyView(closing.state)).toEqual({ disabled: false, copied: true, forceOpen: undefined })
    expect(closing.effects).toEqual([
      { type: "timer.schedule", event: "tooltip.reset-due", attempt: 1, delayMs: ABOUT_COPY_CLOSE_MS },
    ])

    const reset = replay([{ type: "tooltip.reset-due", attempt: 1 }], closing.state)
    expect(selectAboutCopyView(reset.state)).toEqual({ disabled: false, copied: false, forceOpen: undefined })
  })

  test.each(["copy.failed", "copy.timed-out"] as const)("%s re-enables the button and reports it", (type) => {
    const settled = replay([{ type: "copy.requested", text: "Version 1.2.3" }, { type, attempt: 1 }])

    expect(selectAboutCopyView(settled.state).disabled).toBe(false)
    expect(settled.effects).toEqual([{ type: "timer.clear" }, { type: "toast.failed" }])
  })

  test("ignores a second click while copying and results of an earlier copy", () => {
    const copying = replay([{ type: "copy.requested", text: "Version 1.2.3" }])
    expect(transitionAboutCopy(copying.state, { type: "copy.requested", text: "Version 1.2.3" }).state).toBe(
      copying.state,
    )

    const again = replay([...copied, { type: "copy.requested", text: "Version 1.2.3" }])
    expect(transitionAboutCopy(again.state, { type: "copy.failed", attempt: 1 }).state).toBe(again.state)
    expect(transitionAboutCopy(again.state, { type: "tooltip.close-due", attempt: 1 }).state).toBe(again.state)
  })

  test("disposal clears the timer and ignores the write that finishes later", () => {
    const disposed = replay([{ type: "copy.requested", text: "Version 1.2.3" }, { type: "disposed" }])

    expect(disposed.effects).toEqual([{ type: "timer.clear" }])
    expect(transitionAboutCopy(disposed.state, { type: "copy.succeeded", attempt: 1 }).state).toBe(disposed.state)
  })
})
