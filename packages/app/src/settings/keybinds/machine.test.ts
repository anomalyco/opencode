import { describe, expect, test } from "bun:test"
import {
  INITIAL_KEYBIND_CAPTURE_STATE,
  LEADER_SLOT,
  selectCapturedChord,
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

const press = (stroke: string, conflictTitles: string[] = []): KeybindCaptureEvent => ({
  type: "key.pressed",
  input: { kind: "stroke", stroke, conflictTitles },
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

  test("strokes build a chord that the pause or Enter saves; a clashing chord starts again", () => {
    const chord = replay([capture("session.beta"), press("mod+k"), press("mod+c")])

    expect(selectCapturedChord(chord.state)).toBe("mod+k mod+c")
    expect(chord.effects).toEqual([{ type: "chord.wait" }])
    expect(transitionKeybindCapture(chord.state, { type: "chord.timeout", conflictTitles: [] }).effects).toEqual([
      { type: "binding.set", id: "session.beta", value: "mod+k mod+c" },
      { type: "keybinds.resume" },
    ])
    expect(
      transitionKeybindCapture(chord.state, {
        type: "key.pressed",
        input: { kind: "enter", stroke: "enter", strokeConflicts: [], finishConflicts: [] },
      }).effects,
    ).toEqual([{ type: "binding.set", id: "session.beta", value: "mod+k mod+c" }, { type: "keybinds.resume" }])

    const clash = transitionKeybindCapture(chord.state, { type: "chord.timeout", conflictTitles: ["Alpha"] })
    expect(selectCapturingKeybind(clash.state)).toBe("session.beta")
    expect(selectCapturedChord(clash.state)).toBe("")
    expect(clash.effects).toEqual([{ type: "notify.conflict", keybind: "mod+k mod+c", conflictTitles: ["Alpha"] }])

    // A late timeout after the chord was saved changes nothing.
    const saved = transitionKeybindCapture(chord.state, { type: "chord.timeout", conflictTitles: [] }).state
    expect(transitionKeybindCapture(saved, { type: "chord.timeout", conflictTitles: [] }).state).toBe(saved)
  })

  test("Enter is a stroke until a chord has started, and a chord ends at its longest", () => {
    const enter = replay([
      capture("session.beta"),
      { type: "key.pressed", input: { kind: "enter", stroke: "enter", strokeConflicts: [], finishConflicts: [] } },
    ])

    expect(selectCapturedChord(enter.state)).toBe("enter")

    const longest = replay([capture("session.beta"), press("a"), press("b"), press("c"), press("d")])
    expect(longest.effects).toEqual([
      { type: "binding.set", id: "session.beta", value: "a b c d" },
      { type: "keybinds.resume" },
    ])
  })

  test("Backspace takes back the last stroke, and with none removes the shortcut", () => {
    const taken = replay([capture("session.beta"), press("mod+k"), backspace])
    expect(selectCapturedChord(taken.state)).toBe("")
    expect(taken.effects).toEqual([])

    expect(replay([capture("session.beta"), backspace]).effects).toEqual([
      { type: "binding.set", id: "session.beta", value: "none" },
      { type: "keybinds.resume" },
    ])
    expect(replay([capture(LEADER_SLOT), backspace]).effects).toEqual([
      { type: "leader.set", value: undefined },
      { type: "keybinds.resume" },
    ])
  })

  test("the leader starts only a command's chord, and the leader slot saves one stroke", () => {
    const leader = replay([capture("session.beta"), { type: "leader.inserted" }, press("n")])
    expect(selectCapturedChord(leader.state)).toBe("<leader> n")
    expect(selectCapturedChord(replay([{ type: "leader.inserted" }], leader.state).state)).toBe("<leader> n")
    expect(selectCapturedChord(replay([capture(LEADER_SLOT), { type: "leader.inserted" }]).state)).toBe("")

    expect(replay([capture(LEADER_SLOT), press("ctrl+x")]).effects).toEqual([
      { type: "leader.set", value: "ctrl+x" },
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
