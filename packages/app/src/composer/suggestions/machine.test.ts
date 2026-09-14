import { describe, expect, test } from "bun:test"
import type { ComposerPersistedState, ComposerSuggestion } from "../types"
import { createComposerInteractionState, transitionComposer } from "./machine"

const command: ComposerSuggestion = {
  id: "review",
  kind: "command",
  label: "/review",
}

function persisted(value = ""): ComposerPersistedState {
  return {
    prompt: [{ type: "text", content: value, start: 0, end: value.length }],
    cursor: value.length,
    context: { items: [] },
  }
}

describe("Composer interaction machine", () => {
  test("opens inline commands only when slash is the entire prompt", () => {
    const state = createComposerInteractionState()
    const open = transitionComposer(state, { type: "input.changed", value: "/re" }, persisted())
    const closed = transitionComposer(state, { type: "input.changed", value: "explain /re" }, persisted())

    expect(open.state.popover).toEqual({ type: "command-inline", query: "re" })
    expect(closed.state.popover).toEqual({ type: "closed" })
  })

  test("completes nested slash command names", () => {
    const open = transitionComposer(
      createComposerInteractionState(),
      { type: "input.changed", value: "/review/" },
      persisted(),
    )
    const item = { ...command, label: "/review/nested" }
    const selected = transitionComposer(open.state, { type: "popover.select", item }, persisted("/review/"))

    expect(open.state.popover).toEqual({ type: "command-inline", query: "review/" })
    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "/review/nested " })
  })

  test("opens context completion at the cursor", () => {
    const value = "alpha @sr omega"
    const input = persisted(value)
    input.cursor = 9

    const result = transitionComposer(
      createComposerInteractionState(),
      { type: "input.changed", value, persist: false },
      input,
    )

    expect(result.state.popover).toEqual({ type: "context", query: "sr" })
  })

  test("enters shell mode from an initial exclamation mark", () => {
    const result = transitionComposer(
      createComposerInteractionState(),
      { type: "input.changed", value: "!", persist: false },
      persisted("!"),
    )

    expect(result.state.mode).toBe("shell")
    expect(result.commands).toContainEqual({ type: "draft.setText", value: "" })
  })

  test("leaves shell mode with escape", () => {
    const state = { ...createComposerInteractionState(), mode: "shell" as const }
    const result = transitionComposer(
      state,
      { type: "key.down", key: "Escape", ctrl: false, composing: false, ids: [] },
      persisted(),
    )

    expect(result.state.mode).toBe("normal")
    expect(result.handled).toBeTrue()
  })

  test("leaves shell mode with backspace when empty", () => {
    const state = { ...createComposerInteractionState(), mode: "shell" as const }
    const result = transitionComposer(
      state,
      { type: "key.down", key: "Backspace", ctrl: false, composing: false, ids: [], empty: true },
      persisted(),
    )

    expect(result.state.mode).toBe("normal")
    expect(result.handled).toBeTrue()
  })

  test("closes a popover with ctrl-g before stopping a run", () => {
    const state = {
      ...createComposerInteractionState(),
      popover: { type: "context" as const, query: "", activeID: "first" },
    }
    const result = transitionComposer(
      state,
      { type: "key.down", key: "g", ctrl: true, composing: false, ids: ["first"] },
      persisted(),
    )

    expect(result.state.popover).toEqual({ type: "closed" })
    expect(result.handled).toBeTrue()
  })

  test("opens the searchable command menu for a populated draft", () => {
    const result = transitionComposer(
      createComposerInteractionState(),
      { type: "commands.open" },
      persisted("existing text"),
    )

    expect(result.state.popover).toEqual({ type: "command-menu", query: "" })
    expect(result.state.focus).toBe("command-search")
  })

  test("prepends a menu command and preserves existing text as arguments", () => {
    const open = transitionComposer(
      createComposerInteractionState(),
      { type: "commands.open" },
      persisted("existing text"),
    )
    const selected = transitionComposer(
      open.state,
      { type: "popover.select", item: command },
      persisted("existing text"),
    )

    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "/review existing text" })
    expect(selected.state.popover).toEqual({ type: "closed" })
  })

  test("stores selected context files as prompt file parts", () => {
    const item: ComposerSuggestion = {
      id: "src/index.ts",
      kind: "file",
      label: "index.ts",
      path: "src/index.ts",
    }
    const state = {
      ...createComposerInteractionState(),
      popover: { type: "context" as const, query: "index" },
    }

    const selected = transitionComposer(state, { type: "popover.select", item }, persisted("@index"))

    expect(selected.commands).toContainEqual({ type: "mention.add", item })
  })

  test("loops active popover items with arrow keys", () => {
    const state = {
      ...createComposerInteractionState(),
      popover: { type: "context" as const, query: "", activeID: "second" },
    }
    const result = transitionComposer(
      state,
      { type: "key.down", key: "ArrowDown", ctrl: false, composing: false, ids: ["first", "second"] },
      persisted(),
    )

    expect(result.state.popover).toEqual({ type: "context", query: "", activeID: "first" })
    expect(result.handled).toBeTrue()
  })
})
