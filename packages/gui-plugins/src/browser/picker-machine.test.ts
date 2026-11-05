import { describe, expect, test } from "bun:test"
import {
  initialPickerState,
  isPickerActive,
  transitionPicker,
  type PickerEvent,
  type PickerState,
  type PickerTransition,
} from "./picker-machine"

// Folds the events in order and returns the last transition.
const replay = (events: readonly PickerEvent[], state: PickerState = initialPickerState) =>
  events.reduce<PickerTransition>((last, event) => transitionPicker(last.state, event), { state, effects: [] })

const types = (transition: PickerTransition) => transition.effects.map((effect) => effect.type)

const target = { backendID: 7, frameID: "main" }

const element = {
  selector: "main > button.primary",
  label: "button.primary",
  rect: { x: 48, y: 40, width: 160, height: 36 },
}

// An armed picker at attempt 1.
const armed = () =>
  replay([
    { type: "inspect.set", enabled: true },
    { type: "arm.succeeded", attempt: 1 },
  ]).state

describe("starting the picker", () => {
  test("reports it on only once Chromium armed it", () => {
    const arming = transitionPicker(initialPickerState, { type: "inspect.set", enabled: true })
    expect(arming.state).toEqual({ status: "arming", attempt: 1 })
    expect(arming.effects).toEqual([
      { type: "timer", phase: "arming", attempt: 1 },
      { type: "arm", attempt: 1 },
    ])

    const started = transitionPicker(arming.state, { type: "arm.succeeded", attempt: 1 })
    expect(started.state.status).toBe("armed")
    expect(started.effects).toEqual([{ type: "report", active: true }])
  })

  test("a failed or hung arm reports the picker off", () => {
    const arming = transitionPicker(initialPickerState, { type: "inspect.set", enabled: true }).state
    const failed = transitionPicker(arming, { type: "arm.failed", attempt: 1 })
    const timedOut = transitionPicker(arming, { type: "timeout", phase: "arming", attempt: 1 })

    expect(failed.state.status).toBe("off")
    expect(types(failed)).toEqual(["disarm", "hide-highlight", "report"])
    expect(failed.effects).toContainEqual({ type: "report", active: false })
    expect(timedOut.state.status).toBe("off")
    expect(types(timedOut)).toEqual(["disarm", "hide-highlight", "report"])
  })

  test("an arm that finishes after the picker was turned off changes nothing", () => {
    const off = replay([
      { type: "inspect.set", enabled: true },
      { type: "inspect.set", enabled: false },
    ]).state

    const late = transitionPicker(off, { type: "arm.succeeded", attempt: 1 })

    expect(late.state).toBe(off)
    expect(late.effects).toEqual([])
  })

  test("asking again while armed reports it on again; the chord toggles", () => {
    const state = armed()

    expect(transitionPicker(state, { type: "inspect.set", enabled: true }).effects).toEqual([
      { type: "report", active: true },
    ])
    expect(transitionPicker(state, { type: "inspect.toggled" }).state.status).toBe("off")
    expect(transitionPicker(initialPickerState, { type: "inspect.toggled" }).state.status).toBe("arming")
  })

  test("a frame that attaches while the picker runs arms its own picker", () => {
    expect(transitionPicker(armed(), { type: "frame.attached", sessionID: "frame" }).effects).toEqual([
      { type: "arm-frame", attempt: 1, sessionID: "frame" },
    ])
    expect(transitionPicker(initialPickerState, { type: "frame.attached", sessionID: "frame" }).effects).toEqual([])
  })
})

describe("picking", () => {
  test("describes the element, then hands it to the window", () => {
    const describing = transitionPicker(armed(), { type: "node.picked", backendID: 7 })
    expect(describing.state).toEqual({ status: "describing", attempt: 2 })
    expect(types(describing)).toEqual(["timer", "describe"])

    const picked = transitionPicker(describing.state, { type: "describe.succeeded", attempt: 2, target, element })
    expect(picked.state.status).toBe("off")
    expect(picked.effects).toEqual([{ type: "pick", target, element }])
  })

  test("a late failure after the picker was armed again leaves the new picker alone", () => {
    const rearmed = replay(
      [
        { type: "node.picked", backendID: 7 },
        { type: "inspect.set", enabled: true },
        { type: "arm.succeeded", attempt: 3 },
      ],
      armed(),
    ).state

    expect(rearmed).toEqual({ status: "armed", attempt: 3 })

    const late = transitionPicker(rearmed, { type: "describe.failed", attempt: 2 })
    expect(late.state).toBe(rearmed)
    expect(late.effects).toEqual([])
  })

  test("a description that finishes after its pick was cancelled hides its highlight and picks nothing", () => {
    const cancelled = replay([{ type: "node.picked", backendID: 7 }, { type: "escape.pressed" }], armed())
    // Escape stops only a waiting picker; the pick being described ends with the page.
    expect(cancelled.state.status).toBe("describing")

    const hidden = replay([{ type: "embed.hidden" }], cancelled.state)
    expect(hidden.state.status).toBe("off")
    expect(types(hidden)).toEqual(["hide-highlight", "report"])

    const late = transitionPicker(hidden.state, { type: "describe.succeeded", attempt: 2, target, element })
    expect(late.effects).toEqual([{ type: "hide-highlight" }])
  })

  test("a description that hangs is dropped at its timeout", () => {
    const describing = transitionPicker(armed(), { type: "node.picked", backendID: 7 }).state
    const timedOut = transitionPicker(describing, { type: "timeout", phase: "describing", attempt: 2 })

    expect(timedOut.state.status).toBe("off")
    expect(timedOut.effects).toContainEqual({ type: "report", active: false })
  })

  test("a new document or agent input stops the picker", () => {
    expect(types(transitionPicker(armed(), { type: "document.changed" }))).toEqual([
      "disarm",
      "hide-highlight",
      "report",
    ])
    expect(types(transitionPicker(armed(), { type: "pointer.command" }))).toEqual([
      "disarm",
      "hide-highlight",
      "report",
    ])
    expect(transitionPicker(initialPickerState, { type: "pointer.command" }).effects).toEqual([])
  })
})

describe("highlights", () => {
  test("a revealed element flashes, then hides", () => {
    const flashing = transitionPicker(initialPickerState, { type: "highlight.requested", target })
    expect(flashing.state).toEqual({ status: "flashing", attempt: 1 })
    expect(flashing.effects).toEqual([{ type: "flash", attempt: 1, target }])

    const shown = transitionPicker(flashing.state, { type: "flash.shown", attempt: 1 })
    expect(shown.effects).toEqual([{ type: "timer", phase: "flashing", attempt: 1 }])

    const ended = transitionPicker(shown.state, { type: "timeout", phase: "flashing", attempt: 1 })
    expect(ended.state.status).toBe("off")
    expect(ended.effects).toEqual([{ type: "hide-highlight" }])
  })

  test("a flash that lands after the picker started schedules no hide", () => {
    const rearmed = replay([
      { type: "highlight.requested", target },
      { type: "inspect.set", enabled: true },
    ]).state

    const late = transitionPicker(rearmed, { type: "flash.shown", attempt: 1 })

    expect(late.state).toBe(rearmed)
    expect(late.effects).toEqual([])
  })

  test("clearing a comment's highlight leaves a running picker alone", () => {
    const state = armed()

    expect(transitionPicker(state, { type: "highlight.requested", target: undefined }).state).toBe(state)
    expect(transitionPicker(initialPickerState, { type: "highlight.requested", target: undefined }).effects).toEqual([
      { type: "hide-highlight" },
    ])
  })

  test("revealing an element while the picker runs ends the picker", () => {
    const flashing = transitionPicker(armed(), { type: "highlight.requested", target })

    expect(types(flashing)).toEqual(["disarm", "report", "flash"])
    expect(isPickerActive(flashing.state)).toBe(false)
  })
})

test("a disposed picker ignores every later answer", () => {
  const closed = replay([{ type: "node.picked", backendID: 7 }, { type: "disposed" }], armed()).state
  expect(closed.status).toBe("closed")

  const events: PickerEvent[] = [
    { type: "describe.succeeded", attempt: 2, target, element },
    { type: "describe.failed", attempt: 2 },
    { type: "flash.shown", attempt: 2 },
    { type: "inspect.set", enabled: true },
    { type: "highlight.requested", target },
  ]

  events.forEach((event) => {
    const next = transitionPicker(closed, event)
    expect(next.state).toBe(closed)
    expect(next.effects).toEqual([])
  })
})
