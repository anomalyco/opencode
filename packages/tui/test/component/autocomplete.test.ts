import { describe, expect, test } from "bun:test"
import { isCompleteCommand, type AutocompleteOption } from "../../src/component/prompt/autocomplete"

// `commands()` pads every display to the width of the longest entry, so the fixtures below keep the
// padding: matching it is the whole point of the predicate.
const commands: AutocompleteOption[] = [
  { display: "/debug         ", onSelect: () => {} },
  { display: "/efficiency    ", aliases: ["/eff"], onSelect: () => {} },
  { display: "/good          ", onSelect: () => {} },
  { display: "/good-thing    ", onSelect: () => {} },
  { display: "/session:list  ", onSelect: () => {} },
]

describe("isCompleteCommand", () => {
  test("matches a display that only differs from the typed name by list padding", () => {
    expect(isCompleteCommand("/good", commands)).toBe(true)
    expect(isCompleteCommand("/debug", commands)).toBe(true)
    expect(isCompleteCommand("/session:list", commands)).toBe(true)
  })

  test("matches an alias", () => {
    expect(isCompleteCommand("/eff", commands)).toBe(true)
  })

  test("keeps the list open while the name is still a prefix", () => {
    expect(isCompleteCommand("/goo", commands)).toBe(false)
    expect(isCompleteCommand("/good-", commands)).toBe(false)
    expect(isCompleteCommand("/", commands)).toBe(false)
  })

  test("keeps the list open once the name is followed by arguments", () => {
    expect(isCompleteCommand("/good clean up", commands)).toBe(false)
    expect(isCompleteCommand("/good-thing now", commands)).toBe(false)
  })

  test("does not match unrelated text or an empty list", () => {
    expect(isCompleteCommand("good", commands)).toBe(false)
    expect(isCompleteCommand("", commands)).toBe(false)
    expect(isCompleteCommand("/good", [])).toBe(false)
  })
})
