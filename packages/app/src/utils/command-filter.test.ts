import { compileCommandFilter, isCommandHidden } from "./command-filter"

describe("command filter", () => {
  test("returns no rules when empty", () => {
    const rules = compileCommandFilter()
    expect(rules).toHaveLength(0)
    expect(isCommandHidden(["open"], rules)).toBe(false)
  })

  test("matches any provided name", () => {
    const rules = compileCommandFilter(["^open$", "^model$"])
    expect(isCommandHidden(["open"], rules)).toBe(true)
    expect(isCommandHidden(["model"], rules)).toBe(true)
    expect(isCommandHidden(["agent"], rules)).toBe(false)
  })

  test("matches alias list", () => {
    const rules = compileCommandFilter(["alias"])
    expect(isCommandHidden(["name", "alias"], rules)).toBe(true)
  })
})
