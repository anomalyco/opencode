import { describe, expect, test } from "bun:test"
import { allModelsVisible } from "./dialog-manage-models-state"

const list = [
  { id: "a", provider: { id: "p1" } },
  { id: "b", provider: { id: "p2" } },
]

describe("dialog manage models", () => {
  test("allModelsVisible is false for empty list", () => {
    expect(allModelsVisible([], () => true)).toBe(false)
  })

  test("allModelsVisible only returns true when every item is visible", () => {
    expect(allModelsVisible(list, () => true)).toBe(true)
    expect(allModelsVisible(list, (item) => item.modelID !== "b")).toBe(false)
  })
})
