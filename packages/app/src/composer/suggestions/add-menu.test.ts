import { describe, expect, test } from "bun:test"
import type { ComposerPersistedState, ComposerSuggestion } from "../types"
import { visibleAddMenuCommands } from "./add-menu"
import { createComposerInteractionState, transitionComposer } from "./machine"

function command(id: string, label: string): ComposerSuggestion {
  return { id, kind: "command", label, trigger: label.slice(1), title: label.slice(1) }
}

function persisted(value = ""): ComposerPersistedState {
  return {
    prompt: [{ type: "text", content: value, start: 0, end: value.length }],
    cursor: value.length,
    context: { items: [] },
  }
}

describe("composer add menu", () => {
  test("keeps only commands in input order", () => {
    const file: ComposerSuggestion = { id: "file:a", kind: "file", label: "a" }
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
    const start = createComposerInteractionState()
    const draft = persisted("existing text")

    const opened = transitionComposer(start, { type: "commands.open" }, draft)
    const selected = transitionComposer(opened.state, { type: "popover.select", item }, draft)

    expect(opened.state.popover).toEqual({ type: "command-menu", query: "" })
    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "/review existing text" })
    expect(selected.state.popover).toEqual({ type: "closed" })
  })

  test("add menu command selection matches inline flow for empty draft", () => {
    const item = command("fix", "/fix")
    const start = createComposerInteractionState()
    const draft = persisted("")

    const opened = transitionComposer(start, { type: "commands.open" }, draft)
    const selected = transitionComposer(opened.state, { type: "popover.select", item }, persisted("/"))

    expect(selected.commands).toContainEqual({ type: "draft.setText", value: "/fix " })
  })
})
