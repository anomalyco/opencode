import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createComposerEditor } from "../src/composer/editor/interaction"
import type { ComposerPersistedState } from "../src/composer/types"

test.each([
  { key: "Escape", isComposing: true, keyCode: 27, list: false, stops: 0, selections: 0, prevented: false },
  { key: "Escape", isComposing: false, keyCode: 229, list: false, stops: 0, selections: 0, prevented: false },
  { key: "Escape", isComposing: false, keyCode: 27, list: false, stops: 1, selections: 0, prevented: true },
  { key: "Tab", isComposing: true, keyCode: 9, list: true, stops: 0, selections: 0, prevented: false },
  { key: "Tab", isComposing: false, keyCode: 229, list: true, stops: 0, selections: 0, prevented: false },
  { key: "Enter", isComposing: false, keyCode: 229, list: true, stops: 0, selections: 0, prevented: false },
  { key: "Tab", isComposing: false, keyCode: 9, list: true, stops: 0, selections: 1, prevented: true },
])("IME key ownership: $key, composing=$isComposing, keyCode=$keyCode", (row) => {
  const value = createRoot((dispose) => {
    const store = createStore<ComposerPersistedState>({ prompt: [], context: { items: [] } })

    const [calls, setCalls] = createStore({ stops: 0, selections: 0 })

    const editor = createComposerEditor({
      store,
      commands: () => [{ id: "review", kind: "command", label: "/review" }],
      context: () => [],
      searchContextFiles: () => [],
      onSuggestionSelect: () => () => setCalls("selections", (count) => count + 1),
      view: {
        submit: {
          working: () => true,
          stopping: () => false,
          onSubmit() {},
          onStop: () => setCalls("stops", (count) => count + 1),
        },
      },
    })

    return { editor, calls, dispose }
  })

  try {
    if (row.list) {
      value.editor.openCommands()
      value.editor.dispatch({ type: "popover.results", ids: ["review"] })
      expect(value.editor.state.popover.type).toBe("command-inline")
      expect(value.editor.suggestions().map((item) => item.id)).toEqual(["review"])
    }

    const event = new KeyboardEvent("keydown", {
      key: row.key,
      isComposing: row.isComposing,
      cancelable: true,
    })

    // happy-dom does not initialize the legacy keyCode field from KeyboardEventInit.
    Object.defineProperty(event, "keyCode", { value: row.keyCode })
    expect(value.editor.onKeyDown(event)).toBe(true)
    expect(value.calls.stops).toBe(row.stops)
    expect(value.calls.selections).toBe(row.selections)
    expect(event.defaultPrevented).toBe(row.prevented)

    if (row.list && !row.selections) expect(value.editor.state.popover.type).toBe("command-inline")
  } finally {
    value.dispose()
  }
})
