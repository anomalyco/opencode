import { compileCommandFilter } from "../../../src/util/command-filter"
import { commandNames, isCommandAllowed } from "../../../src/cli/cmd/tui/util/command-filter"

describe("tui command filter", () => {
  test("builds name list with aliases", () => {
    const names = commandNames({ value: "value", slash: { name: "open", aliases: ["o"] } })
    expect(names).toEqual(["open", "o"])
  })

  test("falls back to value when no slash", () => {
    const names = commandNames({ value: "session.new" })
    expect(names).toEqual(["session.new"])
  })

  test("blocks when any alias matches", () => {
    const rules = compileCommandFilter(["^o$"])
    const allowed = isCommandAllowed({ value: "value", slash: { name: "open", aliases: ["o"] } }, rules)
    expect(allowed).toBe(false)
  })
})
