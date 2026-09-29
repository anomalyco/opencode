import { describe, expect, test } from "bun:test"
import type { PromptInputV2PersistedState, PromptInputV2Suggestion } from "./types"
import { createPromptInputV2InteractionState, transitionPromptInputV2 } from "./machine"

const command: PromptInputV2Suggestion = {
  id: "review",
  kind: "command",
  label: "/review",
  trigger: "review",
  command: "custom",
}

function persisted(value = ""): PromptInputV2PersistedState {
  return {
    prompt: [{ type: "text", content: value, start: 0, end: value.length }],
    cursor: value.length,
    context: { items: [] },
  }
}

describe("prompt input v2 interaction machine", () => {
  test.each([
    { value: "/re", cursor: 3, query: "re", start: 0 },
    { value: "explain /re", cursor: 11, query: "re", start: 8 },
    { value: "prefix/re suffix", cursor: 9, query: "re", start: 6 },
    { value: "first\nsecond/", cursor: 13, query: "", start: 12 },
    { value: "before/review/after", cursor: 14, query: "review/", start: 6 },
  ])("opens and completes a command at any cursor position in $value", ({ value, cursor, query, start }) => {
    const input = { ...persisted(value), cursor }
    const open = transitionPromptInputV2(
      createPromptInputV2InteractionState(),
      { type: "input.changed", value, persist: false },
      input,
    )

    expect(open.state.popover).toEqual({ type: "command-inline", query })
    expect(open.commands).toContainEqual({ type: "popover.filter", popover: "command", query })

    const selected = transitionPromptInputV2(open.state, { type: "popover.select", item: command }, input)

    expect(selected.commands).toContainEqual({
      type: "command.add",
      start,
      end: cursor,
      name: "review",
      content: "/review",
    })
    expect(selected.state.popover).toEqual({ type: "closed" })
  })

  test.each([
    { value: "/re existing text", cursor: 0 },
    { value: "/re existing text", cursor: 17 },
    { value: "explain /re rest", cursor: 16 },
  ])("does not open commands when the cursor is outside the slash query at $cursor", ({ value, cursor }) => {
    const result = transitionPromptInputV2(
      createPromptInputV2InteractionState(),
      { type: "input.changed", value, persist: false },
      { ...persisted(value), cursor },
    )

    expect(result.state.popover).toEqual({ type: "closed" })
  })

  test("completes nested slash command names", () => {
    const open = transitionPromptInputV2(
      createPromptInputV2InteractionState(),
      { type: "input.changed", value: "/review/" },
      persisted(),
    )
    const item = { ...command, label: "/review/nested", trigger: "review/nested" }
    const selected = transitionPromptInputV2(open.state, { type: "popover.select", item }, persisted("/review/"))

    expect(open.state.popover).toEqual({ type: "command-inline", query: "review/" })
    expect(selected.commands).toContainEqual({
      type: "command.add",
      start: 0,
      end: 8,
      name: "review/nested",
      content: "/review/nested",
    })
  })

  test("opens context completion at the cursor", () => {
    const value = "alpha @sr omega"
    const input = persisted(value)
    input.cursor = 9

    const result = transitionPromptInputV2(
      createPromptInputV2InteractionState(),
      { type: "input.changed", value, persist: false },
      input,
    )

    expect(result.state.popover).toEqual({ type: "context", query: "sr" })
  })

  test("enters shell mode from an initial exclamation mark", () => {
    const result = transitionPromptInputV2(
      createPromptInputV2InteractionState(),
      { type: "input.changed", value: "!", persist: false },
      persisted("!"),
    )

    expect(result.state.mode).toBe("shell")
    expect(result.commands).toContainEqual({ type: "draft.setText", value: "" })
  })

  test("leaves shell mode with escape", () => {
    const state = { ...createPromptInputV2InteractionState(), mode: "shell" as const }
    const result = transitionPromptInputV2(
      state,
      { type: "key.down", key: "Escape", ctrl: false, composing: false, ids: [] },
      persisted(),
    )

    expect(result.state.mode).toBe("normal")
    expect(result.handled).toBeTrue()
  })

  test("leaves shell mode with backspace when empty", () => {
    const state = { ...createPromptInputV2InteractionState(), mode: "shell" as const }
    const result = transitionPromptInputV2(
      state,
      { type: "key.down", key: "Backspace", ctrl: false, composing: false, ids: [], empty: true },
      persisted(),
    )

    expect(result.state.mode).toBe("normal")
    expect(result.handled).toBeTrue()
  })

  test("closes a popover with ctrl-g before stopping a run", () => {
    const state = {
      ...createPromptInputV2InteractionState(),
      popover: { type: "context" as const, query: "", activeID: "first" },
    }
    const result = transitionPromptInputV2(
      state,
      { type: "key.down", key: "g", ctrl: true, composing: false, ids: ["first"] },
      persisted(),
    )

    expect(result.state.popover).toEqual({ type: "closed" })
    expect(result.handled).toBeTrue()
  })

  test("opens the searchable command menu for a populated draft", () => {
    const result = transitionPromptInputV2(
      createPromptInputV2InteractionState(),
      { type: "commands.open" },
      persisted("existing text"),
    )

    expect(result.state.popover).toEqual({ type: "command-menu", query: "" })
    expect(result.state.focus).toBe("command-search")
  })

  test("prepends a menu command and preserves existing text as arguments", () => {
    const open = transitionPromptInputV2(
      createPromptInputV2InteractionState(),
      { type: "commands.open" },
      persisted("existing text"),
    )
    const selected = transitionPromptInputV2(
      open.state,
      { type: "popover.select", item: command },
      persisted("existing text"),
    )

    expect(selected.commands).toContainEqual({
      type: "command.add",
      start: 0,
      end: 0,
      name: "review",
      content: "/review",
    })
    expect(selected.state.popover).toEqual({ type: "closed" })
  })

  test("stores selected context files as prompt file parts", () => {
    const item: PromptInputV2Suggestion = {
      id: "src/index.ts",
      kind: "file",
      label: "index.ts",
      path: "src/index.ts",
    }
    const state = {
      ...createPromptInputV2InteractionState(),
      popover: { type: "context" as const, query: "index" },
    }

    const selected = transitionPromptInputV2(state, { type: "popover.select", item }, persisted("@index"))

    expect(selected.commands).toContainEqual({ type: "mention.add", item })
  })

  test("loops active popover items with arrow keys", () => {
    const state = {
      ...createPromptInputV2InteractionState(),
      popover: { type: "context" as const, query: "", activeID: "second" },
    }
    const result = transitionPromptInputV2(
      state,
      { type: "key.down", key: "ArrowDown", ctrl: false, composing: false, ids: ["first", "second"] },
      persisted(),
    )

    expect(result.state.popover).toEqual({ type: "context", query: "", activeID: "first" })
    expect(result.handled).toBeTrue()
  })
})
