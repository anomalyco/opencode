import { describe, expect, test } from "bun:test"
import { TextAttributes } from "@opentui/core"
import { todoPresentation } from "../../src/component/todo-item"

describe("todo presentation", () => {
  test("marks completed and in-progress todos", () => {
    expect(todoPresentation("completed")).toEqual({ marker: "✓", attributes: undefined })
    expect(todoPresentation("in_progress")).toEqual({ marker: "•", attributes: undefined })
  })

  test("keeps pending todos as an empty box", () => {
    expect(todoPresentation("pending")).toEqual({ marker: " ", attributes: undefined })
  })

  test("strikes through cancelled todos instead of showing them as pending", () => {
    expect(todoPresentation("cancelled")).toEqual({ marker: "✕", attributes: TextAttributes.STRIKETHROUGH })
  })

  test("treats unknown statuses as pending", () => {
    expect(todoPresentation("something-else")).toEqual({ marker: " ", attributes: undefined })
  })
})
