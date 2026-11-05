import { describe, expect, test } from "bun:test"
import {
  createDialogStackState,
  selectLayerClosing,
  selectLayerIndex,
  selectLayerModal,
  selectTopDialog,
  transitionDialogStack,
  type DialogStackEffect,
  type DialogStackEvent,
  type DialogStackState,
} from "./dialog-machine"

type Event = DialogStackEvent<string, string>

// Focus is where it was when the open was asked for; the request names the content the driver would mount.
const open = (mode: "show" | "push", id: string, aborted = false): Event => ({
  type: "open",
  mode,
  id,
  aborted,
  focus: `before ${id}`,
  request: id,
})

const push = (id: string) => open("push", id)

const show = (id: string) => open("show", id)

function run(state: DialogStackState<string>, ...events: Event[]) {
  return events.reduce<{ state: DialogStackState<string>; effects: readonly DialogStackEffect<string, string>[] }>(
    (result, event) => transitionDialogStack(result.state, event),
    { state, effects: [] },
  )
}

function closed(attempt: number, delayMs: number, focus?: string): DialogStackEffect<string, string>[] {
  return [
    { type: "timer.start", attempt, delayMs },
    { type: "notify.close", attempt },
    ...(focus ? [{ type: "focus.return" as const, attempt, focus }] : []),
  ]
}

const statuses = (state: DialogStackState<string>) =>
  state.status === "active" ? state.entries.map((entry) => `${entry.id}:${entry.status}`) : []

describe("closing a lower dialog by id", () => {
  // A at the bottom plays the image preview's 960 ms flight out; B on top must close at once, however it is closed.
  const below = run(
    createDialogStackState(),
    push("a"),
    { type: "layer.exit-duration", attempt: 1, exitMs: 960 },
    push("b"),
    { type: "close", id: "a" },
  )

  test("starts only that dialog's exit and leaves focus with the top dialog", () => {
    expect(below.effects).toEqual(closed(1, 960))
    expect(statuses(below.state)).toEqual(["a:closing", "b:open"])
    expect(selectTopDialog(below.state)?.id).toBe("b")
  })

  test.each<[string, Event]>([
    ["Escape", { type: "dismiss" }],
    ["a backdrop click", { type: "backdrop.click", attempt: 2 }],
    ["its close button", { type: "layer.dismiss", attempt: 2 }],
    ["an un-keyed close", { type: "close" }],
    ["a dismissal by id", { type: "dismiss", id: "b" }],
  ])("does not block %s on the top dialog", (_, event) => {
    const next = transitionDialogStack(below.state, event)

    expect(next.effects).toEqual(closed(2, 100, "before b"))
    expect(statuses(next.state)).toEqual(["a:closing", "b:closing"])
  })
})

describe("while the top dialog plays its exit animation", () => {
  const exiting = run(createDialogStackState(), push("a"), push("b"), { type: "dismiss" })

  test("the dialog below is the top dialog and owns the focus trap", () => {
    expect(selectTopDialog(exiting.state)?.id).toBe("a")
    expect(selectLayerModal(exiting.state, 1, false)).toBe(true)
    expect(selectLayerModal(exiting.state, 2, false)).toBe(false)
    expect(selectLayerModal(exiting.state, 1, true)).toBe(false)
  })

  test.each<[string, Event]>([
    ["its close button", { type: "layer.dismiss", attempt: 2 }],
    ["its backdrop", { type: "backdrop.click", attempt: 2 }],
    ["a dismissal by its id", { type: "dismiss", id: "b" }],
    ["a second un-keyed close", { type: "close" }],
    ["a second close from inside it", { type: "close", layer: 2 }],
  ])("%s does nothing more", (_, event) => {
    const next = transitionDialogStack(exiting.state, event)

    expect(next.state).toBe(exiting.state)
    expect(next.effects).toEqual([])
  })

  test.each<[string, Event]>([
    ["Escape", { type: "dismiss" }],
    ["a dismissal by its id", { type: "dismiss", id: "a" }],
    ["its close button", { type: "layer.dismiss", attempt: 1 }],
    ["its backdrop", { type: "backdrop.click", attempt: 1 }],
    ["a close by its id", { type: "close", id: "a" }],
    ["its own Cancel (a close from inside it)", { type: "close", layer: 1 }],
  ])("%s closes the dialog below at once", (_, event) => {
    const next = transitionDialogStack(exiting.state, event)

    expect(next.effects).toEqual(closed(1, 100, "before a"))
    expect(statuses(next.state)).toEqual(["a:closing", "b:closing"])
  })

  test("an un-keyed close from outside every dialog waits for the exit, then closes the dialog below", () => {
    const next = run(exiting.state, { type: "exit.completed", attempt: 2 }, { type: "close" })

    expect(next.effects).toEqual(closed(1, 100, "before a"))
  })
})

describe("a close without an id from inside a dialog", () => {
  const stacked = run(createDialogStackState(), push("a"), push("b"))

  test("closes that dialog, not the one on top, and leaves focus with the top dialog", () => {
    const next = transitionDialogStack(stacked.state, { type: "close", layer: 1 })

    expect(next.effects).toEqual(closed(1, 100))
    expect(statuses(next.state)).toEqual(["a:closing", "b:open"])
  })

  test("closes only itself on a double click, never the dialog below", () => {
    const first = transitionDialogStack(stacked.state, { type: "close", layer: 2 })
    const second = transitionDialogStack(first.state, { type: "close", layer: 2 })

    expect(first.effects).toEqual(closed(2, 100, "before b"))
    expect(second.state).toBe(first.state)
    expect(second.effects).toEqual([])
  })

  test("from a dialog a show replaced, closes the newest dialog as a close from outside does", () => {
    const replaced = run(stacked.state, show("c"))
    const next = transitionDialogStack(replaced.state, { type: "close", layer: 1 })

    expect(next.effects).toEqual(closed(3, 100, "before a"))
  })
})

test("a layer reads closing as soon as its close starts, before its exit animation ends", () => {
  const opened = run(createDialogStackState(), push("a"))
  const closing = run(opened.state, { type: "dismiss" })

  expect(selectLayerClosing(opened.state, 1)).toBe(false)
  expect(selectLayerClosing(closing.state, 1)).toBe(true)
  // Escape stops being captured, though the dialog stays mounted for its exit animation.
  expect(selectTopDialog(closing.state)).toBeUndefined()
  expect(statuses(closing.state)).toEqual(["a:closing"])

  const gone = run(closing.state, { type: "exit.completed", attempt: 1 })

  expect(gone.effects).toEqual([{ type: "dispose", attempt: 1, notify: false }])
  expect(statuses(gone.state)).toEqual([])
})

test("an id reused while its earlier dialog exits names only the new dialog", () => {
  const reused = run(createDialogStackState(), push("x"), { type: "close", id: "x" }, push("x"))

  expect(selectTopDialog(reused.state)?.attempt).toBe(2)
  expect(selectLayerClosing(reused.state, 1)).toBe(true)
  expect(selectLayerClosing(reused.state, 2)).toBe(false)

  const exited = run(reused.state, { type: "exit.completed", attempt: 1 })

  expect(exited.effects).toEqual([{ type: "dispose", attempt: 1, notify: false }])
  expect(statuses(exited.state)).toEqual(["x:open"])
  expect(selectLayerIndex(exited.state, 2)).toBe(0)
  expect(run(exited.state, { type: "close", id: "x" }).effects).toEqual(closed(2, 100, "before x"))
})

describe("a dialog that opts out of backdrop dismissal", () => {
  const kept = run(createDialogStackState(), push("a"), { type: "layer.backdrop-dismiss", attempt: 1, enabled: false })

  test("stays open on a backdrop click", () => {
    const next = transitionDialogStack(kept.state, { type: "backdrop.click", attempt: 1 })

    expect(next.state).toBe(kept.state)
    expect(next.effects).toEqual([])
  })

  test.each<[string, Event]>([
    ["Escape", { type: "dismiss" }],
    ["its close button", { type: "layer.dismiss", attempt: 1 }],
    ["an un-keyed close", { type: "close" }],
  ])("still closes on %s", (_, event) => {
    expect(transitionDialogStack(kept.state, event).effects).toEqual(closed(1, 100, "before a"))
  })

  test("an unchanged setting writes nothing", () => {
    const next = transitionDialogStack(kept.state, { type: "layer.backdrop-dismiss", attempt: 1, enabled: false })

    expect(next.state).toBe(kept.state)
  })
})

test("a replacing dialog returns focus to the origin and never notifies a closing dialog again", () => {
  const before = run(createDialogStackState(), push("a"), push("b"), { type: "close", id: "b" })
  const next = transitionDialogStack(before.state, show("c"))

  expect(next.effects).toEqual([
    { type: "dispose", attempt: 1, notify: true },
    { type: "timer.stop", attempt: 2 },
    { type: "dispose", attempt: 2, notify: false },
    { type: "mount", attempt: 3, id: "c", request: "c" },
  ])
  expect(statuses(next.state)).toEqual(["c:open"])
  expect(run(next.state, { type: "dismiss" }).effects).toEqual(closed(3, 100, "before a"))
})

test("an open whose signal aborted neither mounts nor replaces, and its caller hears onClose", () => {
  const before = run(createDialogStackState(), push("a"))
  const next = transitionDialogStack(before.state, open("show", "b", true))

  expect(next.state).toBe(before.state)
  expect(next.effects).toEqual([{ type: "discard", request: "b", notify: true }])
})

describe("exit timers and disposal", () => {
  test.each<[string, Event[]]>([
    ["an open dialog", [push("a")]],
    ["a dialog already gone", [push("a"), { type: "dismiss" }, { type: "exit.completed", attempt: 1 }]],
    ["a replaced dialog", [push("a"), { type: "dismiss" }, show("b")]],
  ])("ignore a late exit for %s", (_, events) => {
    const before = run(createDialogStackState(), ...events)
    const next = transitionDialogStack(before.state, { type: "exit.completed", attempt: 1 })

    expect(next.state).toBe(before.state)
    expect(next.effects).toEqual([])
  })

  test("a longer exit asked for after the close starts does not change the running timer", () => {
    const before = run(createDialogStackState(), push("a"), { type: "dismiss" })
    const next = transitionDialogStack(before.state, { type: "layer.exit-duration", attempt: 1, exitMs: 960 })

    expect(next.state).toBe(before.state)
  })

  test("the provider going away stops exit timers, disposes every dialog silently and ignores what follows", () => {
    const before = run(createDialogStackState(), push("a"), push("b"), { type: "dismiss" })
    const gone = transitionDialogStack(before.state, { type: "disposed" })

    expect(gone.effects).toEqual([
      { type: "dispose", attempt: 1, notify: false },
      { type: "timer.stop", attempt: 2 },
      { type: "dispose", attempt: 2, notify: false },
    ])
    expect(selectTopDialog(gone.state)).toBeUndefined()
    expect(selectLayerClosing(gone.state, 1)).toBe(true)

    const late = [
      { type: "dismiss" },
      { type: "close" },
      { type: "exit.completed", attempt: 2 },
      { type: "disposed" },
    ] satisfies Event[]

    late.forEach((event) => {
      const next = transitionDialogStack(gone.state, event)

      expect(next.state).toBe(gone.state)
      expect(next.effects).toEqual([])
    })
    expect(transitionDialogStack(gone.state, push("c")).effects).toEqual([
      { type: "discard", request: "c", notify: false },
    ])
    expect(transitionDialogStack(gone.state, open("push", "c", true)).effects).toEqual([
      { type: "discard", request: "c", notify: true },
    ])
  })
})
