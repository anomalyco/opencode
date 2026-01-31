import { describe, expect, test } from "bun:test"
import { compileCommandFilter, isCommandHidden } from "../../src/util/command-filter"

describe("command filter", () => {
  test("does not hide without rules", () => {
    const rules = compileCommandFilter()
    expect(isCommandHidden(["open"], rules)).toBe(false)
  })

  test("hides when any name matches", () => {
    const rules = compileCommandFilter(["^open$", "model$"])
    expect(isCommandHidden(["open"], rules)).toBe(true)
    expect(isCommandHidden(["choose-model"], rules)).toBe(true)
    expect(isCommandHidden(["agent"], rules)).toBe(false)
  })

  test("hides when alias matches", () => {
    const rules = compileCommandFilter(["alt"])
    expect(isCommandHidden(["name", "alt"], rules)).toBe(true)
  })
})
