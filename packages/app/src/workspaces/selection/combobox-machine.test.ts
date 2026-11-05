import { expect, test } from "bun:test"
import {
  createPickerComboboxState,
  pickerComboboxView,
  transitionPickerCombobox,
  type PickerComboboxContext,
  type PickerComboboxEvent,
  type PickerComboboxState,
  type PickerComboboxTransition,
  type PickerSuggestion,
} from "./combobox-machine"
import { pickerMode } from "./domain"

const context: PickerComboboxContext = {
  policy: pickerMode("directory"),
  home: "/home/luke",
  root: "/projects",
  fallback: "/home/luke",
  locationDirectory: "/projects",
}

const key = (name: string, options: { shiftKey?: boolean; composing?: boolean } = {}): PickerComboboxEvent => ({
  type: "key.down",
  key: name,
  shiftKey: options.shiftKey ?? false,
  composing: options.composing ?? false,
})

const directory = (absolute: string): PickerSuggestion => ({ absolute, type: "directory" })

function run(events: PickerComboboxEvent[], state = createPickerComboboxState(), input = context) {
  return events.reduce<PickerComboboxTransition>(
    (current, event) => transitionPickerCombobox(current.state, event, input),
    { state, effects: [], preventDefault: false, stopPropagation: false },
  )
}

function attempt(state: PickerComboboxState) {
  return state.status === "disposed" ? 0 : state.attempt
}

// Types `input` and resolves its search with `items`.
function opened(input: string, items: PickerSuggestion[]) {
  const typed = run([{ type: "input.changed", value: input }])

  return run([{ type: "search.resolved", attempt: attempt(typed.state), items }], typed.state).state
}

test("Enter while the next query searches submits the typed path, not the previous query's first result", () => {
  const old = opened("/projects/old", [directory("/projects/old-repo")])
  const typed = run([{ type: "input.changed", value: "/projects/new" }], old)
  const entered = run([key("Enter")], typed.state)

  expect(typed.state.status).toBe("loading")
  expect(pickerComboboxView(typed.state).items).toEqual([])
  expect(entered.preventDefault).toBeTrue()
  expect(entered.effects).toEqual([{ type: "search.cancel" }, { type: "choose.directory", path: "/projects/new" }])
  expect(entered.state).toEqual({ status: "closed", attempt: attempt(typed.state), input: "/projects/new/" })
})

test("Tab while the next query searches completes nothing", () => {
  const old = opened("/projects/old", [directory("/projects/old-repo")])
  const typed = run([{ type: "input.changed", value: "/projects/new" }], old)
  const tabbed = run([key("Tab")], typed.state)

  expect(tabbed.state).toBe(typed.state)
  expect(tabbed.effects).toEqual([])
  expect(tabbed.preventDefault).toBeFalse()
})

test("results of an earlier search never open the list for later input", () => {
  const first = run([{ type: "input.changed", value: "/projects/old" }])
  const second = run([{ type: "input.changed", value: "/projects/new" }], first.state)
  const late = run([{ type: "search.resolved", attempt: attempt(first.state), items: [directory("/x")] }], second.state)

  expect(second.effects).toEqual([
    { type: "selection.clear" },
    { type: "search.start", attempt: attempt(first.state) + 1, query: "/projects/new", timeoutMs: 10_000 },
  ])
  expect(late.state).toBe(second.state)
})

test.each([
  ["~/op", 0],
  ["~/opencode/", -1],
  ["C:\\Users\\luke\\", -1],
  ["~", -1],
  ["~/", -1],
  ["/", -1],
])("%p highlights suggestion %p until the user steps", (input, active) => {
  const items = [directory("/home/luke/opencode"), directory("/home/luke/opera")]
  const state = opened(input, items)
  const entered = run([key("Enter")], state)

  expect(pickerComboboxView(state).active).toBe(active)
  expect(entered.effects.at(-1)).toEqual({
    type: "choose.directory",
    path: active === 0 ? "/home/luke/opencode" : input,
  })
  expect(pickerComboboxView(run([key("ArrowDown")], state).state).active).toBe(active === 0 ? 1 : 0)
})

test("arrow keys wrap through the list and reopen a closed list after a search", () => {
  const state = opened("~/op", [directory("/home/luke/a"), directory("/home/luke/b")])
  const up = run([key("ArrowUp")], state)
  const closed = run([key("Escape")], state)
  const reopening = run([key("ArrowDown")], closed.state)

  expect(pickerComboboxView(up.state).active).toBe(1)
  expect(up.preventDefault).toBeTrue()
  expect(reopening.state).toMatchObject({ status: "loading", step: 1 })
  expect(reopening.effects).toEqual([
    { type: "search.start", attempt: attempt(state) + 1, query: "~/op", timeoutMs: 10_000 },
  ])

  const resolved = run(
    [{ type: "search.resolved", attempt: attempt(reopening.state), items: [directory("/a"), directory("/b")] }],
    reopening.state,
  )

  expect(pickerComboboxView(resolved.state).active).toBe(1)
})

test("Escape closes an open list without reaching the dialog, and otherwise passes through", () => {
  const state = opened("~/op", [directory("/home/luke/a")])
  const escaped = run([key("Escape")], state)
  const passed = run([key("Escape")], escaped.state)

  expect(escaped).toMatchObject({
    state: { status: "closed", input: "~/op" },
    preventDefault: true,
    stopPropagation: true,
  })
  expect(passed).toMatchObject({ preventDefault: false, stopPropagation: false })
  expect(passed.state).toBe(escaped.state)
})

test("Shift+Tab and IME Enter pass through", () => {
  const state = opened("~/op", [directory("/home/luke/a")])

  expect(run([key("Tab", { shiftKey: true })], state)).toMatchObject({ preventDefault: false, effects: [] })
  expect(run([key("Enter", { composing: true })], state)).toMatchObject({ preventDefault: false, effects: [] })
})

test("hovering the active item again keeps the same state", () => {
  const state = opened("~/op", [directory("/home/luke/a"), directory("/home/luke/b")])
  const hovered = run([{ type: "item.hovered", index: 1 }], state)

  expect(pickerComboboxView(hovered.state).active).toBe(1)
  expect(run([{ type: "item.hovered", index: 1 }], hovered.state).state).toBe(hovered.state)
  expect(run([{ type: "item.hovered", index: 5 }], hovered.state).state).toBe(hovered.state)
})

test("Tab completes a folder and searches inside it, and chooses a file", () => {
  const files = { ...context, policy: pickerMode("file", "/projects") }
  const state = opened("~/op", [directory("/home/luke/opencode")])
  const folder = run([key("Tab")], state)
  const file = { absolute: "/projects/src/index.ts", type: "file" as const }
  const typed = run([{ type: "input.changed", value: "src/in" }], createPickerComboboxState(), files)
  const listed = run([{ type: "search.resolved", attempt: attempt(typed.state), items: [file] }], typed.state, files)

  expect(folder.preventDefault).toBeTrue()
  expect(folder.state).toMatchObject({ status: "loading", input: "~/opencode/" })
  expect(folder.effects).toEqual([
    { type: "search.start", attempt: attempt(state) + 1, query: "~/opencode/", timeoutMs: 10_000 },
  ])

  for (const event of [key("Tab"), { type: "item.clicked", index: 0 } as const]) {
    const chosen = run([event], listed.state, files)

    expect(chosen.state).toMatchObject({ status: "closed", input: "/projects/src/index.ts" })
    expect(chosen.effects).toEqual([{ type: "choose.file", absolute: file.absolute }])
  }
})

test("clicking a folder suggestion chooses it and shows it as the input", () => {
  const state = opened("~/op", [directory("/home/luke/opencode")])
  const clicked = run([{ type: "item.clicked", index: 0 }], state)

  expect(clicked.state).toMatchObject({ status: "closed", input: "~/opencode/" })
  expect(clicked.effects).toEqual([{ type: "choose.directory", path: "/home/luke/opencode" }])
})

test("input typed before the location resolves searches once the location arrives", () => {
  const booting = { ...context, root: "", locationDirectory: undefined }
  const typed = run([{ type: "input.changed", value: "~/op" }], createPickerComboboxState(), booting)
  const located = run([{ type: "context.changed" }], typed.state)

  expect(typed.state).toMatchObject({ status: "open", input: "~/op", items: [] })
  expect(typed.effects).toEqual([{ type: "selection.clear" }])
  expect(located.state).toMatchObject({ status: "loading", input: "~/op" })
  expect(located.effects).toEqual([
    { type: "search.start", attempt: attempt(typed.state) + 1, query: "~/op", timeoutMs: 10_000 },
  ])
  expect(run([{ type: "context.changed" }], createPickerComboboxState()).state.status).toBe("closed")
})

test.each(["search.failed", "search.timed-out"] as const)("%s opens an empty list", (type) => {
  const typed = run([{ type: "input.changed", value: "~/op" }])
  const settled = run([{ type, attempt: attempt(typed.state) }], typed.state)

  expect(settled.state).toMatchObject({ status: "open", items: [], active: null })
  expect(pickerComboboxView(settled.state).listboxOpen).toBeFalse()
  expect(settled.effects).toEqual(type === "search.timed-out" ? [{ type: "search.cancel" }] : [])
})

test("clearing, dismissing and disposing cancel a running search", () => {
  const typed = run([{ type: "input.changed", value: "~/op" }])
  const cleared = run([{ type: "cleared" }], typed.state)
  const dismissed = run([{ type: "dismissed" }], typed.state)
  const disposed = run([{ type: "disposed" }], typed.state)

  expect(cleared).toMatchObject({ state: { status: "closed", input: "" }, effects: [{ type: "search.cancel" }] })
  expect(dismissed).toMatchObject({ state: { status: "closed", input: "~/op" }, effects: [{ type: "search.cancel" }] })
  expect(disposed).toMatchObject({ state: { status: "disposed" }, effects: [{ type: "search.cancel" }] })
  expect(run([{ type: "input.changed", value: "x" }], disposed.state).state).toBe(disposed.state)
  expect(run([{ type: "cleared" }], cleared.state).state).toBe(cleared.state)
})

test("input equal to the open root has nothing to suggest", () => {
  const typed = run([{ type: "input.changed", value: "/projects/" }])

  expect(typed.state).toMatchObject({ status: "open", items: [] })
  expect(typed.effects).toEqual([{ type: "selection.clear" }])
})
