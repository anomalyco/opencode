import { describe, expect, test } from "bun:test"
import {
  INITIAL_KEYBIND_CAPTURE_STATE,
  selectCapturePrefix,
  selectCapturingKeybind,
  selectExtendableKeybind,
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

const press = (stroke: string, conflictTitles: string[] = []): KeybindCaptureEvent => ({
  type: "key.pressed",
  input: { kind: "stroke", stroke, conflictTitles },
})

const extend = (id: string, chord: string): KeybindCaptureEvent => ({
  type: "capture.extended",
  id,
  chord,
  pageActive: true,
})

const backspace: KeybindCaptureEvent = { type: "key.pressed", input: { kind: "backspace" } }

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

  test("a key saves at once, and + adds the next key to the saved shortcut", () => {
    const saved = replay([capture("session.beta"), press("mod+k")])

    expect(saved.effects).toEqual([
      { type: "binding.set", id: "session.beta", value: "mod+k" },
      { type: "keybinds.resume" },
    ])
    expect(selectExtendableKeybind(saved.state)).toBe("session.beta")

    const extending = replay([extend("session.beta", "mod+k")], saved.state)
    expect(extending.effects).toEqual([{ type: "keybinds.suspend" }])
    expect(replay([press("mod+c")], extending.state).effects).toEqual([
      { type: "binding.set", id: "session.beta", value: "mod+k mod+c" },
      { type: "keybinds.resume" },
    ])

    // Recording another row, or unbinding, takes the + away.
    expect(selectExtendableKeybind(replay([capture("session.alpha")], saved.state).state)).toBeUndefined()
    expect(selectExtendableKeybind(replay([{ type: "unbind.clicked", id: "x" }], saved.state).state)).toBeUndefined()
  })

  test("a clashing key keeps recording the same chord", () => {
    const extending = replay([extend("session.beta", "mod+k")]).state
    const clash = transitionKeybindCapture(extending, press("mod+c", ["Alpha"]))

    expect(clash.state).toBe(extending)
    expect(selectCapturePrefix(clash.state)).toBe("mod+k")
    expect(clash.effects).toEqual([{ type: "notify.conflict", keybind: "mod+k mod+c", conflictTitles: ["Alpha"] }])
  })

  test("Backspace drops the key being added, and with nothing before it removes the shortcut", () => {
    const dropped = replay([extend("session.beta", "mod+k"), backspace])
    expect(selectCapturingKeybind(dropped.state)).toBe("session.beta")
    expect(selectCapturePrefix(dropped.state)).toBe("")
    expect(dropped.effects).toEqual([])

    expect(replay([capture("session.beta"), backspace]).effects).toEqual([
      { type: "binding.set", id: "session.beta", value: "none" },
      { type: "keybinds.resume" },
    ])
  })

  test("modifier-only keys are ignored and Escape stops recording", () => {
    const capturing = replay([capture("session.beta")]).state

    expect(transitionKeybindCapture(capturing, { type: "key.pressed", input: { kind: "modifier-only" } }).state).toBe(
      capturing,
    )
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
    expect(
      transitionKeybindCapture(disposed.state, { type: "key.pressed", input: { kind: "escape" } }).effects,
    ).toEqual([])
  })
})
