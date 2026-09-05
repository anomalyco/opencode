import { describe, expect, test } from "bun:test"
import type { PromptInputV2PersistedState, PromptInputV2Suggestion } from "./types"
import { createPromptInputV2InteractionState, isWholePromptTrigger, transitionPromptInputV2 } from "./machine"

const command: PromptInputV2Suggestion = {
  id: "review",
  kind: "command",
  label: "/review",
}

function persisted(value = ""): PromptInputV2PersistedState {
  return {
    prompt: [{ type: "text", content: value, start: 0, end: value.length }],
    cursor: value.length,
    context: { items: [] },
  }
}

describe("prompt input v2 interaction machine", () => {
  test("opens inline commands mid-prompt at the cursor", () => {
    const state = createPromptInputV2InteractionState()
    const open = transitionPromptInputV2(state, { type: "input.changed", value: "/re" }, persisted("/re"))
    const mid = transitionPromptInputV2(state, { type: "input.changed", value: "explain /re" }, persisted("explain /re"))

    expect(open.state.popover).toEqual({ type: "command-inline", query: "re" })
    expect(mid.state.popover).toEqual({ type: "command-inline", query: "re" })
  })

  test("does not open on in-word paths or urls", () => {
    const state = createPromptInputV2InteractionState()
    const path = transitionPromptInputV2(state, { type: "input.changed", value: "edit src/app.tsx" }, persisted("edit src/app.tsx"))
    const url = transitionPromptInputV2(state, { type: "input.changed", value: "open https://x.com" }, persisted("open https://x.com"))

    expect(path.state.popover).toEqual({ type: "closed" })
    expect(url.state.popover).toEqual({ type: "closed" })
  })

  test("splices a mid-prompt command and preserves surrounding text", () => {
    const value = "a /rev b"
    const input = persisted(value)
    input.cursor = 6
    const state = { ...createPromptInputV2InteractionState(), popover: { type: "command-inline" as const, query: "rev" } }

    const selected = transitionPromptInputV2(state, { type: "popover.select", item: command }, input)

    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "a /review b", cursor: 9 })
  })

  test("completes the command token at the cursor, not the first slash", () => {
    const value = "fix /a and /re"
    const input = persisted(value)
    input.cursor = value.length
    const state = { ...createPromptInputV2InteractionState(), popover: { type: "command-inline" as const, query: "re" } }

    const selected = transitionPromptInputV2(state, { type: "popover.select", item: command }, input)

    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "fix /a and /review ", cursor: 19 })
  })

  test("completes nested slash command names", () => {
    const open = transitionPromptInputV2(
      createPromptInputV2InteractionState(),
      { type: "input.changed", value: "/review/" },
      persisted("/review/"),
    )
    const item = { ...command, label: "/review/nested" }
    const selected = transitionPromptInputV2(open.state, { type: "popover.select", item }, persisted("/review/"))

    expect(open.state.popover).toEqual({ type: "command-inline", query: "review/" })
    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "/review/nested ", cursor: 15 })
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

    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "/review existing text" })
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

  test("isWholePromptTrigger distinguishes a start-of-prompt slash from a mid-prompt one", () => {
    const whole = persisted("/rev")
    const trailingSpace = persisted("/rev ")
    trailingSpace.cursor = 4
    const midPrompt = persisted("explain /rev")
    const withSuffix = persisted("/rev omega")
    withSuffix.cursor = 4

    expect(isWholePromptTrigger(whole)).toBeTrue()
    expect(isWholePromptTrigger(trailingSpace)).toBeTrue()
    expect(isWholePromptTrigger(midPrompt)).toBeFalse()
    expect(isWholePromptTrigger(withSuffix)).toBeFalse()
  })
})
