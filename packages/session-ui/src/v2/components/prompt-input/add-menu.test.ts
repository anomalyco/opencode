import { describe, expect, test } from "bun:test"
import type { PromptInputV2PersistedState, PromptInputV2Suggestion } from "./types"
import { visibleAddMenuCommands } from "./add-menu"
import { createPromptInputV2InteractionState, transitionPromptInputV2 } from "./machine"

function command(id: string, label: string): PromptInputV2Suggestion {
  return { id, kind: "command", label, trigger: label.slice(1), title: label.slice(1) }
}

function persisted(value = ""): PromptInputV2PersistedState {
  return {
    prompt: [{ type: "text", content: value, start: 0, end: value.length }],
    cursor: value.length,
    context: { items: [] },
  }
}

describe("prompt input v2 add menu", () => {
  test("keeps only commands in input order", () => {
    const file: PromptInputV2Suggestion = { id: "file:a", kind: "file", label: "a" }
    const input = [command("b", "/b"), file, command("a", "/a")]

    const visible = visibleAddMenuCommands(input)

    expect(visible.map((item) => item.id)).toEqual(["b", "a"])
  })

  test("drops duplicate command ids keeping the first", () => {
    const first = { ...command("dup", "/first"), description: "first" }
    const second = { ...command("dup", "/second"), description: "second" }

    const visible = visibleAddMenuCommands([first, second])

    expect(visible).toEqual([first])
  })

  test("returns empty for empty input", () => {
    expect(visibleAddMenuCommands([])).toEqual([])
  })

  test("add menu command selection matches command menu for populated draft", () => {
    const item = { ...command("review", "/review"), description: "Review" }
    const start = createPromptInputV2InteractionState()
    const draft = persisted("existing text")

    const opened = transitionPromptInputV2(start, { type: "commands.open" }, draft)
    const selected = transitionPromptInputV2(opened.state, { type: "popover.select", item }, draft)

    expect(opened.state.popover).toEqual({ type: "command-menu", query: "" })
    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "/review existing text" })
    expect(selected.state.popover).toEqual({ type: "closed" })
  })

  test("add menu command selection matches inline flow for empty draft", () => {
    const item = command("fix", "/fix")
    const start = createPromptInputV2InteractionState()
    const draft = persisted("")

    const opened = transitionPromptInputV2(start, { type: "commands.open" }, draft)
    const selected = transitionPromptInputV2(opened.state, { type: "popover.select", item }, persisted("/"))

    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "/fix " })
  })
})
