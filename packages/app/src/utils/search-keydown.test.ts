import { describe, expect, test } from "bun:test"
import { handleDocumentSearchKeydown } from "./search-keydown"

describe("handleDocumentSearchKeydown", () => {
  test("deletes a supplementary Unicode character without splitting it", () => {
    const input = document.createElement("input")
    const value = "model 🚀"
    input.value = value
    input.setSelectionRange(value.length, value.length)
    const updates: string[] = []

    handleDocumentSearchKeydown(
      input,
      new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }),
      value,
      (next) => updates.push(next),
    )

    expect(updates).toEqual(["model "])
    expect(input.value).toBe("model ")
    expect(input.selectionStart).toBe(6)
  })

  test("moves across a supplementary Unicode character without entering it", () => {
    const input = document.createElement("input")
    const value = "a🚀b"
    input.value = value
    input.setSelectionRange(3, 3)

    handleDocumentSearchKeydown(
      input,
      new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true }),
      value,
      () => {},
    )

    expect(input.selectionStart).toBe(1)
    expect(input.selectionEnd).toBe(1)
  })
})
