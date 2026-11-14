import { describe, expect, test } from "bun:test"
import {
  INITIAL_KEYBIND_CAPTURE_STATE,
  selectCapturingKeybind,
  transitionKeybindCapture,
  type KeybindCaptureEffect,
  type KeybindCaptureEvent,
  type KeybindCaptureState,
} from "./machine"

function replay(events: KeybindCaptureEvent[], state = INITIAL_KEYBIND_CAPTURE_STATE) {
  return events.reduce<{ state: KeybindCaptureState; effects: readonly KeybindCaptureEffect[] }>(
    (step, event) => transitionKeybindCapture(step.state, event),
    { state, effects: [] },
  )
}

const capture = (id: string, pageActive = true): KeybindCaptureEvent => ({ type: "capture.toggled", id, pageActive })

describe("keybind capture machine", () => {
  test("moving the recording to another row keeps shortcuts suspended", () => {
    const first = replay([capture("session.alpha")])
    expect(first.effects).toEqual([{ type: "keybinds.suspend" }])

    const moved = replay([capture("session.beta")], first.state)
    expect(selectCapturingKeybind(moved.state)).toBe("session.beta")
    expect(moved.effects).toEqual([])

    const stopped = replay([capture("session.beta")], moved.state)
    expect(selectCapturingKeybind(stopped.state)).toBeNull()
    expect(stopped.effects).toEqual([{ type: "keybinds.resume" }])
  })

  test.each<{ name: string; event: KeybindCaptureEvent }>([
    { name: "focus moves into a text field", event: { type: "capture.cancelled" } },
    { name: "the page is hidden", event: { type: "page.synced", active: false } },
    { name: "its plugin is removed", event: { type: "catalog.synced", ids: new Set(["session.alpha"]) } },
  ])("recording ends and shortcuts resume when $name", (row) => {
    const ended = replay([capture("acme.open"), row.event])

    expect(selectCapturingKeybind(ended.state)).toBeNull()
    expect(ended.effects).toEqual([{ type: "keybinds.resume" }])
  })

  test("a hidden page does not start recording, and toggling from it stops", () => {
    const ignored = transitionKeybindCapture(INITIAL_KEYBIND_CAPTURE_STATE, capture("session.alpha", false))
    expect(ignored.state).toBe(INITIAL_KEYBIND_CAPTURE_STATE)
    expect(ignored.effects).toEqual([])

    expect(replay([capture("session.alpha"), capture("session.beta", false)]).effects).toEqual([
      { type: "keybinds.resume" },
    ])
  })

  test("a conflicting combination keeps recording; a free one binds and resumes", () => {
    const capturing = replay([capture("session.beta")]).state

    const conflict = transitionKeybindCapture(capturing, {
      type: "key.pressed",
      input: { kind: "combo", keybind: "mod+a", conflictTitles: ["Alpha"] },
    })

    expect(conflict.state).toBe(capturing)
    expect(conflict.effects).toEqual([{ type: "notify.conflict", keybind: "mod+a", conflictTitles: ["Alpha"] }])

    expect(
      transitionKeybindCapture(capturing, {
        type: "key.pressed",
        input: { kind: "combo", keybind: "mod+x", conflictTitles: [] },
      }).effects,
    ).toEqual([{ type: "binding.set", id: "session.beta", value: "mod+x" }, { type: "keybinds.resume" }])
    expect(transitionKeybindCapture(capturing, { type: "key.pressed", input: { kind: "modifier-only" } }).state).toBe(
      capturing,
    )
    expect(transitionKeybindCapture(capturing, { type: "key.pressed", input: { kind: "clear" } }).effects).toEqual([
      { type: "binding.set", id: "session.beta", value: "none" },
      { type: "keybinds.resume" },
    ])
    expect(transitionKeybindCapture(capturing, { type: "key.pressed", input: { kind: "escape" } }).effects).toEqual([
      { type: "keybinds.resume" },
    ])
  })

  test("unbind and reset resume only when recording", () => {
    expect(replay([{ type: "unbind.clicked", id: "session.alpha" }]).effects).toEqual([
      { type: "binding.set", id: "session.alpha", value: "none" },
    ])
    expect(replay([capture("session.alpha"), { type: "reset.clicked" }]).effects).toEqual([
      { type: "keybinds.resume" },
      { type: "bindings.reset" },
      { type: "notify.reset" },
    ])
  })

  test("disposal resumes shortcuts once and ignores later keys", () => {
    const disposed = replay([capture("session.alpha"), { type: "disposed" }])
    expect(disposed.effects).toEqual([{ type: "keybinds.resume" }])
    expect(transitionKeybindCapture(disposed.state, { type: "key.pressed", input: { kind: "escape" } }).effects).toEqual(
      [],
    )
  })
})
