import { describe, expect, test } from "bun:test"
import { hints } from "../../src/command/index"

describe("command hints", () => {
  test("orders numbered placeholders numerically, not lexicographically", () => {
    const template = "use $1 $2 $10 $11 $3"
    expect(hints(template)).toEqual(["$1", "$2", "$3", "$10", "$11"])
  })

  test("deduplicates repeated placeholders", () => {
    expect(hints("$1 $1 $2 $2")).toEqual(["$1", "$2"])
  })

  test("appends $ARGUMENTS after numbered placeholders", () => {
    expect(hints("$1 $2 $ARGUMENTS")).toEqual(["$1", "$2", "$ARGUMENTS"])
  })

  test("returns empty list when there are no placeholders", () => {
    expect(hints("no placeholders here")).toEqual([])
  })
})
